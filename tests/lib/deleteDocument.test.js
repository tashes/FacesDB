import { vi, beforeEach, describe, test, expect } from "vitest";
import { deleteDocument } from "../../lib/deleteDocument";

let checkCollection = vi.spyOn(
    await import("../../utils/checks"),
    "checkCollection",
);
let checkDocument = vi.spyOn(
    await import("../../utils/checks"),
    "checkDocument",
);
let deletejsonl = vi.spyOn(await import("../../utils/fs"), "deletejsonl");
let exists = vi.spyOn(await import("../../utils/fs"), "exists");
let jsonlexists = vi.spyOn(await import("../../utils/fs"), "jsonlexists");
let rm = vi.spyOn(await import("../../utils/fs"), "rm");
let listCollectionIndexes = vi.spyOn(
    await import("../../lib/listCollectionIndexes"),
    "listCollectionIndexes",
);

beforeEach(() => {
    checkCollection.mockClear();
    checkDocument.mockClear();
    deletejsonl.mockClear();
    exists.mockClear();
    jsonlexists.mockClear();
    rm.mockClear();
    listCollectionIndexes.mockClear();
});

describe("Normal run", () => {
    test("Should delete document and clean up indexes", async () => {
        checkCollection.mockImplementation(() => null);
        checkDocument.mockImplementation(() => null);
        exists.mockImplementation(() => true);
        rm.mockImplementation(() => {});
        listCollectionIndexes.mockImplementation(() => ["index1", "index2"]);
        jsonlexists.mockImplementation(() => true);
        deletejsonl.mockImplementation(() => {});

        let collection = "collectionname";
        let document = "documentname";

        await deleteDocument(collection, document);

        expect(rm).toHaveBeenCalledWith(collection, `${document}.json`);
        expect(deletejsonl).toHaveBeenCalledTimes(2);
        expect(deletejsonl).toHaveBeenCalledWith(
            document,
            collection,
            "index1.jsonl",
        );
        expect(deletejsonl).toHaveBeenCalledWith(
            document,
            collection,
            "index2.jsonl",
        );
    });

    test("Should throw error if document does not exist", async () => {
        checkCollection.mockImplementation(() => null);
        checkDocument.mockImplementation(() => null);
        exists.mockImplementation(() => false);
        rm.mockImplementation(() => {});
        listCollectionIndexes.mockImplementation(() => ["index1", "index2"]);
        jsonlexists.mockImplementation(() => true);
        deletejsonl.mockImplementation(() => {});

        let collection = "collectionname";
        let document = "documentname";

        await expect(deleteDocument(collection, document)).rejects.toThrowError(
            "Cannot run deleteDocument:Document does not exist",
        );
    });
});

describe("Initialization error", () => {
    test("Should throw error for invalid collection", async () => {
        checkCollection.mockImplementation(() => new Error("Error"));

        let collection = "collectionname";
        let document = "documentname";

        await expect(deleteDocument(collection, document)).rejects.toThrowError(
            "Cannot start deleteDocument:Error",
        );
    });

    test("Should throw error for invalid document", async () => {
        checkCollection.mockImplementation(() => null);
        checkDocument.mockImplementation(() => new Error("Error"));

        let collection = "collectionname";
        let document = "documentname";

        await expect(deleteDocument(collection, document)).rejects.toThrowError(
            "Cannot start deleteDocument:Error",
        );
    });
});

describe("Function errors", () => {
    test("Should throw error if rm fails", async () => {
        checkCollection.mockImplementation(() => null);
        checkDocument.mockImplementation(() => null);
        exists.mockImplementation(() => true);
        rm.mockImplementation(() => {
            throw new Error("Error");
        });

        let collection = "collectionname";
        let document = "documentname";

        await expect(deleteDocument(collection, document)).rejects.toThrowError(
            "Cannot run deleteDocument:Error",
        );
    });

    test("Should throw error if jsonlexists fails", async () => {
        checkCollection.mockImplementation(() => null);
        checkDocument.mockImplementation(() => null);
        exists.mockImplementation(() => true);
        rm.mockImplementation(() => {});
        listCollectionIndexes.mockImplementation(() => ["index1"]);
        jsonlexists.mockImplementation(() => {
            throw new Error("Error");
        });

        let collection = "collectionname";
        let document = "documentname";

        await expect(deleteDocument(collection, document)).rejects.toThrowError(
            "Cannot run deleteDocument:Error",
        );
    });

    test("Should throw error if deletejsonl fails", async () => {
        checkCollection.mockImplementation(() => null);
        checkDocument.mockImplementation(() => null);
        exists.mockImplementation(() => true);
        rm.mockImplementation(() => {});
        listCollectionIndexes.mockImplementation(() => ["index1"]);
        jsonlexists.mockImplementation(() => true);
        deletejsonl.mockImplementation(() => {
            throw new Error("Error");
        });

        let collection = "collectionname";
        let document = "documentname";

        await expect(deleteDocument(collection, document)).rejects.toThrowError(
            "Cannot run deleteDocument:Error",
        );
    });
});
