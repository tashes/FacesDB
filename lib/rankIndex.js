import {
    checkCollection,
    checkFn,
    checkIndex,
} from "../utils/checks.js";
import { Wrap } from "../utils/errors.js";
import { readfile, replacejsonl } from "../utils/fs.js";

export async function rankIndex(index, collection, sorter, exclusion) {
    const indexError = checkIndex(index);
    if (indexError instanceof Error)
        throw Wrap("Cannot start rankIndex", indexError);
    const collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start rankIndex", collectionError);
    const sorterError = checkFn(sorter);
    if (sorterError instanceof Error)
        throw Wrap("Cannot start rankIndex", sorterError);
    if (exclusion !== undefined) {
        const exclusionError = checkFn(exclusion);
        if (exclusionError instanceof Error)
            throw Wrap("Cannot start rankIndex", exclusionError);
    }

    try {
        const source = readfile(collection, `${index}.jsonl`).toString();
        const lines = source.length === 0
            ? []
            : source.endsWith("\n")
                ? source.slice(0, -1).split("\n")
                : source.split("\n");
        const entries = lines
            .map((line) => JSON.parse(line))
            .filter((entry) => exclusion === undefined || exclusion(entry) !== true)
            .map((entry, position) => ({ entry, position }));

        entries.sort((a, b) => {
            const result = Number(sorter(a.entry, b.entry));
            return Number.isNaN(result) || result === 0
                ? a.position - b.position
                : result;
        });

        replacejsonl(
            entries.map(({ entry }) => entry),
            collection,
            `${index}.jsonl`,
        );
    } catch (e) {
        throw Wrap("Cannot run rankIndex", e);
    }
}
