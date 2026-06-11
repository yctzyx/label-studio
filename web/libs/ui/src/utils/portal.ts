const PORTAL_ROOT_ID = "ls-iframe-portal-root";

export const getPortalContainer = () => {
  if (typeof document === "undefined") return undefined;

  let portalRoot = document.getElementById(PORTAL_ROOT_ID);

  if (!portalRoot) {
    portalRoot = document.createElement("div");
    portalRoot.id = PORTAL_ROOT_ID;
    portalRoot.dataset.lsPortalRoot = "true";
    document.body.appendChild(portalRoot);
  }

  return portalRoot;
};
