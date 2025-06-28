import { vi, beforeEach, describe, test, expect } from "vitest";
import { createIndex } from "../../lib/createIndex";

let checkCollection = vi.spyOn(
    await import("../../utils/checks"),
    "checkCollection",
);
let checkIndex = vi.spyOn(await import("../../utils/checks"), "checkIndex");
let checkIndexConfig = vi.spyOn(
    await import("../../utils/checks"),
    "checkIndexConfig",
);
let appendjsonl = vi.spyOn(await import("../../utils/fs"), "appendjsonl");
let exists = vi.spyOn(await import("../../utils/fs"), "exists");
let readfile = vi.spyOn(await import("../../utils/fs"), "readfile");
let listCollectionDocuments = vi.spyOn(
    await import("../../lib/listCollectionDocuments"),
    "listCollectionDocuments",
);

beforeEach(() => {
    checkCollection.mockClear();
    checkIndex.mockClear();
    checkIndexConfig.mockClear();
    appendjsonl.mockClear();
    exists.mockClear();
    readfile.mockClear();
    listCollectionDocuments.mockClear();
});

describe("Normal run", () => {
    test("Should create index and save documents to the index", async () => {
        let files = {
            doc1: {
                prop1: "WORKER",
                prop2: true,
                prop3: 37,
            },
            doc2: {
                prop4: "MAN",
                prop8: "WOMAN",
            },
        };

        checkIndex.mockImplementation(() => true);
        checkIndexConfig.mockImplementation(() => true);
        checkCollection.mockImplementation(() => true);
        appendjsonl.mockImplementation(() => {});
        exists.mockImplementation(() => false);
        readfile.mockImplementation((_, filename) =>
            JSON.stringify(files[filename]),
        );
        listCollectionDocuments.mockImplementation(() => Object.keys(files));

        let index = "indexname";
        let config = { prop1: true, prop2: false };
        let collection = "collectionname";

        await createIndex(index, config, collection);

        expect(appendjsonl).toHaveBeenCalledTimes(1);
        expect(appendjsonl).toHaveBeenNthCalledWith(
            1,
            { _id: "doc1", prop1: "WORKER", prop2: true },
            "collectionname",
            "indexname.json",
        );
    });

    test("Should throw error for pre-existing index", async () => {
        let files = {
            doc1: {
                prop1: "WORKER",
                prop2: true,
                prop3: 37,
            },
            doc2: {
                prop4: "MAN",
                prop8: "WOMAN",
            },
        };

        checkIndex.mockImplementation(() => true);
        checkIndexConfig.mockImplementation(() => true);
        checkCollection.mockImplementation(() => true);
        appendjsonl.mockImplementation(() => {});
        exists.mockImplementation(() => true);
        readfile.mockImplementation((_, filename) =>
            JSON.stringify(files[filename]),
        );
        listCollectionDocuments.mockImplementation(() => Object.keys(files));

        let index = "indexname";
        let config = { prop1: true, prop2: false };
        let collection = "collectionname";

        await expect(
            createIndex(index, config, collection),
        ).rejects.toThrowError("Cannot run createIndex:Index exists");
    });
});

describe("Initialization error", () => {
    test("Should throw error for invalid index", async () => {
        let files = {
            doc1: {
                prop1: "WORKER",
                prop2: true,
                prop3: 37,
            },
            doc2: {
                prop4: "MAN",
                prop8: "WOMAN",
            },
        };

        checkIndex.mockImplementation(() => new Error("Error"));
        checkIndexConfig.mockImplementation(() => true);
        checkCollection.mockImplementation(() => true);
        appendjsonl.mockImplementation(() => {});
        exists.mockImplementation(() => false);
        readfile.mockImplementation((_, filename) =>
            JSON.stringify(files[filename]),
        );
        listCollectionDocuments.mockImplementation(() => Object.keys(files));

        let index = "indexname";
        let config = { prop1: true, prop2: false };
        let collection = "collectionname";

        await expect(
            createIndex(index, config, collection),
        ).rejects.toThrowError("Cannot start createIndex:Error");
    });

    test("Should throw error for invalid index config", async () => {
        let files = {
            doc1: {
                prop1: "WORKER",
                prop2: true,
                prop3: 37,
            },
            doc2: {
                prop4: "MAN",
                prop8: "WOMAN",
            },
        };

        checkIndex.mockImplementation(() => true);
        checkIndexConfig.mockImplementation(() => new Error("Error"));
        checkCollection.mockImplementation(() => true);
        appendjsonl.mockImplementation(() => {});
        exists.mockImplementation(() => false);
        readfile.mockImplementation((_, filename) =>
            JSON.stringify(files[filename]),
        );
        listCollectionDocuments.mockImplementation(() => Object.keys(files));

        let index = "indexname";
        let config = { prop1: true, prop2: false };
        let collection = "collectionname";

        await expect(
            createIndex(index, config, collection),
        ).rejects.toThrowError("Cannot start createIndex:Error");
    });

    test("Should throw error for invalid collection", async () => {
        let files = {
            doc1: {
                prop1: "WORKER",
                prop2: true,
                prop3: 37,
            },
            doc2: {
                prop4: "MAN",
                prop8: "WOMAN",
            },
        };

        checkIndex.mockImplementation(() => true);
        checkIndexConfig.mockImplementation(() => true);
        checkCollection.mockImplementation(() => new Error("Error"));
        appendjsonl.mockImplementation(() => {});
        exists.mockImplementation(() => false);
        readfile.mockImplementation((_, filename) =>
            JSON.stringify(files[filename]),
        );
        listCollectionDocuments.mockImplementation(() => Object.keys(files));

        let index = "indexname";
        let config = { prop1: true, prop2: false };
        let collection = "collectionname";

        await expect(
            createIndex(index, config, collection),
        ).rejects.toThrowError("Cannot start createIndex:Error");
    });
});

describe("Function errors", () => {
    test("Should throw error for appendjsonl error", async () => {
        let files = {
            doc1: {
                prop1: "WORKER",
                prop2: true,
                prop3: 37,
            },
            doc2: {
                prop4: "MAN",
                prop8: "WOMAN",
            },
        };

        checkIndex.mockImplementation(() => true);
        checkIndexConfig.mockImplementation(() => true);
        checkCollection.mockImplementation(() => true);
        appendjsonl.mockImplementation(() => {
            throw new Error("Error");
        });
        exists.mockImplementation(() => false);
        readfile.mockImplementation((_, filename) =>
            JSON.stringify(files[filename]),
        );
        listCollectionDocuments.mockImplementation(() => Object.keys(files));

        let index = "indexname";
        let config = { prop1: true, prop2: false };
        let collection = "collectionname";

        await expect(
            createIndex(index, config, collection),
        ).rejects.toThrowError("Cannot run createIndex:Error");
    });

    test("Should throw error for exists error", async () => {
        let files = {
            doc1: {
                prop1: "WORKER",
                prop2: true,
                prop3: 37,
            },
            doc2: {
                prop4: "MAN",
                prop8: "WOMAN",
            },
        };

        checkIndex.mockImplementation(() => true);
        checkIndexConfig.mockImplementation(() => true);
        checkCollection.mockImplementation(() => true);
        appendjsonl.mockImplementation(() => {});
        exists.mockImplementation(() => {
            throw new Error("Error");
        });
        readfile.mockImplementation((_, filename) =>
            JSON.stringify(files[filename]),
        );
        listCollectionDocuments.mockImplementation(() => Object.keys(files));

        let index = "indexname";
        let config = { prop1: true, prop2: false };
        let collection = "collectionname";

        await expect(
            createIndex(index, config, collection),
        ).rejects.toThrowError("Cannot run createIndex:Error");
    });

    test("Should throw error for readfile error", async () => {
        let files = {
            doc1: {
                prop1: "WORKER",
                prop2: true,
                prop3: 37,
            },
            doc2: {
                prop4: "MAN",
                prop8: "WOMAN",
            },
        };

        checkIndex.mockImplementation(() => true);
        checkIndexConfig.mockImplementation(() => true);
        checkCollection.mockImplementation(() => true);
        appendjsonl.mockImplementation(() => {});
        exists.mockImplementation(() => false);
        readfile.mockImplementation(() => {
            throw new Error("Error");
        });
        listCollectionDocuments.mockImplementation(() => Object.keys(files));

        let index = "indexname";
        let config = { prop1: true, prop2: false };
        let collection = "collectionname";

        await expect(
            createIndex(index, config, collection),
        ).rejects.toThrowError("Cannot run createIndex:Error");
    });

    test("Should throw error for listCollectionDocuments error", async () => {
        checkIndex.mockImplementation(() => true);
        checkIndexConfig.mockImplementation(() => true);
        checkCollection.mockImplementation(() => true);
        appendjsonl.mockImplementation(() => {});
        exists.mockImplementation(() => false);
        readfile.mockImplementation(() =>
            JSON.stringify({ prop1: "value1", prop2: "value2" }),
        );
        listCollectionDocuments.mockImplementation(() => {
            throw new Error("Error");
        });

        let index = "indexname";
        let config = { prop1: true, prop2: false };
        let collection = "collectionname";

        await expect(
            createIndex(index, config, collection),
        ).rejects.toThrowError("Cannot run createIndex:Error");
    });
});
