import { log } from "../main.js";

export function enableSidebarNameWrap() {
    document.body.classList.add("nd5t-sidebar-name-wrap");
    log("Sidebar Name Wrap enabled");
}

export function disableSidebarNameWrap() {
    document.body.classList.remove("nd5t-sidebar-name-wrap");
    log("Sidebar Name Wrap disabled");
}
