import { cn } from "../../utils/bem";
import { Menu } from "../Menu/Menu";
import "./SidebarMenu.scss";

export const SidebarMenu = ({ children, menu, path, menuItems, navigationPrefix }) => {
  const rootClass = cn("sidebar-menu");

  return (
    <div className={rootClass}>
      {menuItems && menuItems.length > 1 ? (
        <div className={rootClass.elem("navigation")}>
          {navigationPrefix ? (
            <div className={rootClass.elem("navigation-prefix").toClassName()}>{navigationPrefix}</div>
          ) : null}
          <Menu>{menuItems ? Menu.Builder(path, menuItems) : menu}</Menu>
        </div>
      ) : null}
      <div className={rootClass.elem("content")}>{children}</div>
    </div>
  );
};
