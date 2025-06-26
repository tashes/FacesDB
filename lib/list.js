import { Wrap } from "../utils/errors";
import { readdir } from "../utils/fs";

export async function list() {
    try {
        return readdir("");
    } catch (e) {
        throw Wrap("Cannot run list", e);
    }
}
