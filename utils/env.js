import "dotenv/config";

export function env(part) {
    switch (part.toUpperCase()) {
        case "FS":
            return process.env.FS || "";
        case "PAGESIZE":
            return parseInt(process.env.PAGESIZE) || 10;
    }
}
