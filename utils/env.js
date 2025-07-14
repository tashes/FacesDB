import "dotenv/config";

import os from "os";
import path from "path";

function getAppDataPath() {
    const homeDir = os.homedir();
    const appName = "FacesDB";

    switch (process.platform) {
        case "darwin":
            return path.join(
                homeDir,
                "Library",
                "Application Support",
                appName,
            );
        case "win32":
            return path.join(
                process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"),
                appName,
            );
        case "linux":
        default:
            return path.join(
                process.env.XDG_DATA_HOME ||
                    path.join(homeDir, ".local", "share"),
                appName,
            );
    }
}

export function env(part) {
    switch (part.toUpperCase()) {
        case "FS":
            return process.env.FS || getAppDataPath();
        case "PAGESIZE":
            return parseInt(process.env.PAGESIZE) || 10;
    }
}
