import { format } from "date-fns";
import { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { Link } from "react-router-dom";
import { useAPI } from "../../providers/ApiProvider";
import { cn } from "../../utils/bem";
import "./VersionNotifier.scss";
import { IconBell } from "@humansignal/icons";

const VersionContext = createContext();

export const VersionProvider = ({ children }) => {
  const api = useAPI();

  const [state, dispatch] = useReducer((state, action) => {
    if (action.type === "fetch-version") {
      return { ...state, ...action.payload };
    }
    return state ?? {};
  }, {});

  const fetchVersion = useCallback(async () => {
    try {
      const response = await api.callApi("version");
      const data = response?.["label-studio-os-package"];
      if (!data || typeof data !== "object") return;

      const version = data.version;
      const latestVersion = data.latest_version_from_pypi;
      const newVersion = data.current_version_is_outdated;
      const uploadTime = data.latest_version_upload_time;

      dispatch({
        type: "fetch-version",
        payload: {
          version: version ?? "",
          latestVersion: latestVersion ?? "",
          newVersion: newVersion ?? false,
          updateTime: uploadTime ? format(new Date(uploadTime), "MMM d") : "",
        },
      });
    } catch (_) {
      // 接口失败（网络/网关异常等）时静默跳过，不报错
    }
  }, []);

  useEffect(() => {
    fetchVersion();
  }, []);

  return <VersionContext.Provider value={state}>{children}</VersionContext.Provider>;
};

export const VersionNotifier = ({ showNewVersion, showCurrentVersion }) => {
  const { newVersion, updateTime, latestVersion, version } = useContext(VersionContext) ?? {};
  const url = `https://labelstud.io/redirect/update?version=${version ?? ""}`;

  return newVersion && showNewVersion ? (
    <li className={cn("version-notifier").toClassName()}>
      <a href={url} target="_blank" rel="noreferrer">
        <div className={cn("version-notifier").elem("icon").toClassName()}>
          <IconBell />
        </div>
        <div className={cn("version-notifier").elem("content").toClassName()}>
          <div className={cn("version-notifier").elem("title").toClassName()} data-date={updateTime}>
            {latestVersion} Available
          </div>
          <div className={cn("version-notifier").elem("description").toClassName()}>Current version: {version}</div>
        </div>
      </a>
    </li>
  ) : version && showCurrentVersion ? (
    <Link className={cn("current-version").toClassName()} to="/version" target="_blank">
      v{version}
    </Link>
  ) : null;
};
