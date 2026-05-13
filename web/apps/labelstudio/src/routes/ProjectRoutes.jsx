import { useRoutesMap } from "../providers/RoutesProvider";
import { resolveRoutes } from "../utils/routeHelpers";
import { RouteWithStaticFallback } from "./RouteWithStaticFallback";

export const ProjectRoutes = ({ content }) => {
  const routes = useRoutesMap();
  const resolvedRoutes = resolveRoutes(routes, { content });
  console.log("[LS-embed] ProjectRoutes", {
    routesCount: routes?.length,
    hasResolvedRoutes: !!resolvedRoutes,
    contentLength: typeof content === "string" ? content?.length : "n/a",
  });
  return resolvedRoutes ? (
    <div className="route-outlet">
      <RouteWithStaticFallback path="/" children={resolvedRoutes} />
    </div>
  ) : null;
};
