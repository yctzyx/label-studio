type OnProgressCallback = (total: number, loaded: number, progress: number) => void;

const MAX_AUTH_RETRIES = 4;

declare global {
  interface Window {
    __LS_IMAGE_REQUEST_HEADERS__?: () => Record<string, string>;
  }
}

/**
 * @class FileLoader
 * @description Allows to download any file from a given URL and provide a data URL for it
 */
export class FileLoader {
  private fileCache: Map<string, string> = new Map();
  private errorCache: Map<string, Error> = new Map();

  /**
   * @method download
   * @description Downloads a file from a given URL and returns a data URL for it
   * @description Progress event available to track download progress
   */
  download(url: string, onProgress?: OnProgressCallback, attempt = 0) {
    if (!url) throw new Error("No URL provided for download");

    return new Promise((resolve, reject) => {
      if (this.fileCache.has(url)) {
        resolve(this.fileCache.get(url));
        return;
      }
      if (this.errorCache.has(url) && attempt === 0) {
        reject(this.errorCache.get(url));
        return;
      }

      const xhr = new XMLHttpRequest();

      xhr.responseType = "blob";

      xhr.addEventListener("load", async () => {
        if (xhr.readyState === 4 && xhr.status === 200) {
          const blob = xhr.response as Blob;
          const { blobIndicatesGatewayAuthFailure } = await import("@humansignal/core");
          const needsAuth =
            typeof window !== "undefined" && Boolean(window.__LS_IMAGE_REQUEST_HEADERS__?.());

          if (
            needsAuth &&
            ((await blobIndicatesGatewayAuthFailure(blob)) ||
              Boolean(blob?.type && !blob.type.startsWith("image/"))) &&
            attempt < MAX_AUTH_RETRIES
          ) {
            const { waitBeforeAuthRetry } = await import("@humansignal/core");
            await waitBeforeAuthRetry(attempt);
            this.errorCache.delete(url);
            this.download(url, onProgress, attempt + 1).then(resolve).catch(reject);
            return;
          }

          const localURL = this.createDataURL(blob);

          this.fileCache.set(url, localURL);
          this.errorCache.delete(url);

          if (xhr.getResponseHeader("content-type")?.match(/image/)) {
            try {
              await this.cacheImage(localURL);
            } catch (err) {
              reject(err);
              return;
            }
          }

          resolve(localURL);
        } else if (
          typeof window !== "undefined" &&
          window.__LS_IMAGE_REQUEST_HEADERS__?.() &&
          (xhr.status === 401 || xhr.status === 403) &&
          attempt < MAX_AUTH_RETRIES
        ) {
          const { waitBeforeAuthRetry } = await import("@humansignal/core");
          await waitBeforeAuthRetry(attempt);
          this.errorCache.delete(url);
          this.download(url, onProgress, attempt + 1).then(resolve).catch(reject);
        } else if (xhr.readyState === 4) {
          const error = new Error(`Failed to download file: ${xhr.status}`);

          reject(error);

          this.errorCache.set(url, error);
        }
      });

      xhr.addEventListener("progress", (e) => {
        const { total, loaded } = e;
        const progress = loaded / total;

        onProgress?.(total, loaded, progress);
      });

      xhr.addEventListener("error", () => {
        const error = new Error("Network error");

        reject(error);

        this.errorCache.set(url, error);
      });

      xhr.open("GET", url);
      const headers =
        typeof window !== "undefined" && window.__LS_IMAGE_REQUEST_HEADERS__?.();
      if (headers && typeof headers === "object") {
        for (const [key, value] of Object.entries(headers)) {
          if (value != null && value !== "") xhr.setRequestHeader(key, String(value));
        }
      }
      xhr.send();
    });
  }

  isPreloaded(url: string) {
    return this.fileCache.has(url);
  }

  isError(url: string) {
    return this.errorCache.has(url);
  }

  getPreloadedURL(url: string) {
    return this.fileCache.get(url);
  }

  getError(url: string) {
    return this.errorCache.get(url);
  }

  clearError(url: string) {
    this.errorCache.delete(url);
  }

  private createDataURL(response: any) {
    const dataURL = URL.createObjectURL(response);

    return dataURL;
  }

  private cacheImage(url: string) {
    return new Promise<void>((resolve, reject) => {
      const image = new Image();

      image.onload = () => {
        resolve();
      };

      image.onerror = () => {
        reject();
      };

      image.src = url;
    });
  }
}
