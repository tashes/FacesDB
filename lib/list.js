import { Wrap } from "../utils/errors.js";
import { isFolder, readdir } from "../utils/fs.js";

export async function list() {
    try {
        let dirContents = readdir("");
        let list = dirContents.filter((item) => isFolder(item));
        return list;
    } catch (e) {
        throw Wrap("Cannot run list", e);
    }
}
