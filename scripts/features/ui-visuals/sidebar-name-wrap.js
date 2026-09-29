/**
 * Feature: Sidebar Multi-line Names
 * Description: Allows long document names in the right sidebar directories to wrap onto multiple lines instead of being truncated with an ellipsis.
 *
 * @introduced v14.1.0
 */
import { log } from "../../main.js";

export function enableSidebarNameWrap() {
    document.body.classList.add("nd5t-sidebar-name-wrap");
    log("Sidebar Name Wrap enabled");
}

export function disableSidebarNameWrap() {
    document.body.classList.remove("nd5t-sidebar-name-wrap");
    log("Sidebar Name Wrap disabled");
}
