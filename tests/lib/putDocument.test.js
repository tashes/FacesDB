import { vi, beforeEach, describe, test, expect } from "vitest";
import { putDocument } from "../../lib/putDocument";

let checkCollection = vi.spyOn(
    await import("../../utils/checks"),
    "checkCollection",
);
let checkDocument = vi.spyOn(
    await import("../../utils/checks"),
    "checkDocument",
);
let checkDocumentobj = vi.spyOn(
    await import("../../utils/checks"),
    "checkDocumentobj",
);
let exists = vi.spyOn(await import("../../utils/fs"), "exists");
let isFile = vi.spyOn(await import("../../utils/fs"), "isFile");
let writejson = vi.spyOn(await import("../../utils/fs"), "writejson");
let appendjsonl = vi.spyOn(await import("../../utils/fs"), "appendjsonl");
let deletejsonl = vi.spyOn(await import("../../utils/fs"), "deletejsonl");
let editjsonlraw = vi.spyOn(await import("../../utils/fs"), "editjsonlraw");
let jsonlexists = vi.spyOn(await import("../../utils/fs"), "jsonlexists");
let listCollectionIndexes = vi.spyOn(
    await import("../../lib/listCollectionIndexes"),
    "listCollectionIndexes",
);
let viewIndexConfig = vi.spyOn(
    await import("../../lib/viewIndexConfig"),
    "viewIndexConfig",
);

beforeEach(() => {
    checkCollection.mockClear();
    checkDocument.mockClear();
    checkDocumentobj.mockClear();
    exists.mockClear();
    isFile.mockClear();
    writejson.mockClear();
    appendjsonl.mockClear();
    deletejsonl.mockClear();
    editjsonlraw.mockClear();
    jsonlexists.mockClear();
    listCollectionIndexes.mockClear();
    viewIndexConfig.mockClear();
});

describe("Normal run", () => {
    test("Should update document and append to indexes when document does not exist", async () => {
        let indexes = {
            indexone: {
                prop1: true,
            },
            indextwo: {
                prop3: true,
                prop4: true,
                prop8: false,
            },
        };

        checkCollection.mockImplementation(() => true);
        checkDocument.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        exists.mockImplementation(() => true);
        isFile.mockImplementation(() => true);
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        deletejsonl.mockImplementation(() => {});
        editjsonlraw.mockImplementation(() => {});
        jsonlexists.mockImplementation(() => false);
        listCollectionIndexes.mockImplementation(() => Object.keys(indexes));
        viewIndexConfig.mockImplementation(
            (_, indexName) => indexes[indexName],
        );

        const collection = "collectionname";
        const document = "doc1";
        const documentobj = {
            prop1: "value3",
            prop2: "value4",
        };

        await putDocument(collection, document, documentobj);

        expect(writejson).toHaveBeenCalledWith(
            {
                prop1: "value3",
                prop2: "value4",
                _id: "doc1",
            },
            collection,
            `${document}.json`,
        );
        expect(appendjsonl).toHaveBeenCalledWith(
            { _id: "doc1", prop1: "value3" },
            collection,
            `indexone.jsonl`,
        );
    });

    test("Should update document and update indexes when document does exist", async () => {
        let indexes = {
            indexone: {
                prop1: true,
            },
            indextwo: {
                prop3: true,
                prop4: true,
                prop8: false,
            },
        };

        checkCollection.mockImplementation(() => true);
        checkDocument.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        exists.mockImplementation(() => true);
        isFile.mockImplementation(() => true);
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        deletejsonl.mockImplementation(() => {});
        editjsonlraw.mockImplementation(() => {});
        jsonlexists.mockImplementation(() => true);
        listCollectionIndexes.mockImplementation(() => Object.keys(indexes));
        viewIndexConfig.mockImplementation(
            (_, indexName) => indexes[indexName],
        );

        const collection = "collectionname";
        const document = "doc1";
        const documentobj = {
            prop1: "value3",
            prop2: "value4",
        };

        await putDocument(collection, document, documentobj);

        expect(writejson).toHaveBeenCalledWith(
            {
                prop1: "value3",
                prop2: "value4",
                _id: "doc1",
            },
            collection,
            `${document}.json`,
        );
        expect(editjsonlraw).toHaveBeenCalledWith(
            "doc1",
            {
                _id: "doc1",
                prop1: "value3",
            },
            collection,
            `indexone.jsonl`,
        );
    });

    test("Should update document and remove from index when document does exist", async () => {
        let indexes = {
            indexone: {
                prop1: true,
            },
            indextwo: {
                prop3: true,
                prop4: true,
                prop8: false,
            },
        };

        checkCollection.mockImplementation(() => true);
        checkDocument.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        exists.mockImplementation(() => true);
        isFile.mockImplementation(() => true);
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        deletejsonl.mockImplementation(() => {});
        editjsonlraw.mockImplementation(() => {});
        jsonlexists.mockImplementation(() => true);
        listCollectionIndexes.mockImplementation(() => Object.keys(indexes));
        viewIndexConfig.mockImplementation(
            (_, indexName) => indexes[indexName],
        );

        const collection = "collectionname";
        const document = "doc1";
        const documentobj = {
            prop5: "value3",
            prop7: "value4",
        };

        await putDocument(collection, document, documentobj);

        expect(writejson).toHaveBeenCalledWith(
            {
                prop5: "value3",
                prop7: "value4",
                _id: "doc1",
            },
            collection,
            `${document}.json`,
        );
        expect(deletejsonl).toHaveBeenCalledTimes(2);
        expect(deletejsonl).toHaveBeenNthCalledWith(
            1,
            document,
            collection,
            "indexone.jsonl",
        );
        expect(deletejsonl).toHaveBeenNthCalledWith(
            2,
            document,
            collection,
            "indextwo.jsonl",
        );
    });
});

describe("Initialization error", () => {
    test("Should throw error for invalid collection", async () => {
        let indexes = {
            indexone: {
                prop1: true,
            },
            indextwo: {
                prop3: true,
                prop4: true,
                prop8: false,
            },
        };

        checkCollection.mockImplementation(() => new Error("Error"));
        checkDocument.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        exists.mockImplementation(() => true);
        isFile.mockImplementation(() => true);
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        deletejsonl.mockImplementation(() => {});
        editjsonlraw.mockImplementation(() => {});
        jsonlexists.mockImplementation(() => false);
        listCollectionIndexes.mockImplementation(() => Object.keys(indexes));
        viewIndexConfig.mockImplementation(
            (_, indexName) => indexes[indexName],
        );

        const collection = "collectionname";
        const document = "doc1";
        const documentobj = {
            prop1: "value3",
            prop2: "value4",
        };

        await expect(
            putDocument(collection, document, documentobj),
        ).rejects.toThrowError("Cannot start putDocument:Error");
    });

    test("Should throw error for invalid document", async () => {
        let indexes = {
            indexone: {
                prop1: true,
            },
            indextwo: {
                prop3: true,
                prop4: true,
                prop8: false,
            },
        };

        checkCollection.mockImplementation(() => true);
        checkDocument.mockImplementation(() => new Error("Error"));
        checkDocumentobj.mockImplementation(() => true);
        exists.mockImplementation(() => true);
        isFile.mockImplementation(() => true);
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        deletejsonl.mockImplementation(() => {});
        editjsonlraw.mockImplementation(() => {});
        jsonlexists.mockImplementation(() => false);
        listCollectionIndexes.mockImplementation(() => Object.keys(indexes));
        viewIndexConfig.mockImplementation(
            (_, indexName) => indexes[indexName],
        );

        const collection = "collectionname";
        const document = "doc1";
        const documentobj = {
            prop1: "value3",
            prop2: "value4",
        };

        await expect(
            putDocument(collection, document, documentobj),
        ).rejects.toThrowError("Cannot start putDocument:Error");
    });

    test("Should throw error for invalid document object", async () => {
        let indexes = {
            indexone: {
                prop1: true,
            },
            indextwo: {
                prop3: true,
                prop4: true,
                prop8: false,
            },
        };

        checkCollection.mockImplementation(() => true);
        checkDocument.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => new Error("Error"));
        exists.mockImplementation(() => true);
        isFile.mockImplementation(() => true);
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        deletejsonl.mockImplementation(() => {});
        editjsonlraw.mockImplementation(() => {});
        jsonlexists.mockImplementation(() => false);
        listCollectionIndexes.mockImplementation(() => Object.keys(indexes));
        viewIndexConfig.mockImplementation(
            (_, indexName) => indexes[indexName],
        );

        const collection = "collectionname";
        const document = "doc1";
        const documentobj = {
            prop1: "value3",
            prop2: "value4",
        };

        await expect(
            putDocument(collection, document, documentobj),
        ).rejects.toThrowError("Cannot start putDocument:Error");
    });
});

describe("Function errors", () => {
    test("Should throw error for exists error", async () => {
        let indexes = {
            indexone: {
                prop1: true,
            },
            indextwo: {
                prop3: true,
                prop4: true,
                prop8: false,
            },
        };

        checkCollection.mockImplementation(() => true);
        checkDocument.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        exists.mockImplementation(() => {
            throw new Error("Error");
        });
        isFile.mockImplementation(() => true);
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        deletejsonl.mockImplementation(() => {});
        editjsonlraw.mockImplementation(() => {});
        jsonlexists.mockImplementation(() => false);
        listCollectionIndexes.mockImplementation(() => Object.keys(indexes));
        viewIndexConfig.mockImplementation(
            (_, indexName) => indexes[indexName],
        );

        const collection = "collectionname";
        const document = "doc1";
        const documentobj = {
            prop1: "value3",
            prop2: "value4",
        };

        await expect(
            putDocument(collection, document, documentobj),
        ).rejects.toThrowError("Cannot run putDocument:Error");
    });

    test("Should throw error for isFile error", async () => {
        let indexes = {
            indexone: {
                prop1: true,
            },
            indextwo: {
                prop3: true,
                prop4: true,
                prop8: false,
            },
        };

        checkCollection.mockImplementation(() => true);
        checkDocument.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        exists.mockImplementation(() => true);
        isFile.mockImplementation(() => {
            throw new Error("Error");
        });
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        deletejsonl.mockImplementation(() => {});
        editjsonlraw.mockImplementation(() => {});
        jsonlexists.mockImplementation(() => false);
        listCollectionIndexes.mockImplementation(() => Object.keys(indexes));
        viewIndexConfig.mockImplementation(
            (_, indexName) => indexes[indexName],
        );

        const collection = "collectionname";
        const document = "doc1";
        const documentobj = {
            prop1: "value3",
            prop2: "value4",
        };

        await expect(
            putDocument(collection, document, documentobj),
        ).rejects.toThrowError("Cannot run putDocument:Error");
    });

    test("Should throw error for writejson error", async () => {
        let indexes = {
            indexone: {
                prop1: true,
            },
            indextwo: {
                prop3: true,
                prop4: true,
                prop8: false,
            },
        };

        checkCollection.mockImplementation(() => true);
        checkDocument.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        exists.mockImplementation(() => true);
        isFile.mockImplementation(() => true);
        writejson.mockImplementation(() => {
            throw new Error("Error");
        });
        appendjsonl.mockImplementation(() => {});
        deletejsonl.mockImplementation(() => {});
        editjsonlraw.mockImplementation(() => {});
        jsonlexists.mockImplementation(() => false);
        listCollectionIndexes.mockImplementation(() => Object.keys(indexes));
        viewIndexConfig.mockImplementation(
            (_, indexName) => indexes[indexName],
        );

        const collection = "collectionname";
        const document = "doc1";
        const documentobj = {
            prop1: "value3",
            prop2: "value4",
        };

        await expect(
            putDocument(collection, document, documentobj),
        ).rejects.toThrowError("Cannot run putDocument:Error");
    });

    test("Should throw error for appendjsonl error", async () => {
        let indexes = {
            indexone: {
                prop1: true,
            },
            indextwo: {
                prop3: true,
                prop4: true,
                prop8: false,
            },
        };

        checkCollection.mockImplementation(() => true);
        checkDocument.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        exists.mockImplementation(() => true);
        isFile.mockImplementation(() => true);
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {
            throw new Error("Error");
        });
        deletejsonl.mockImplementation(() => {});
        editjsonlraw.mockImplementation(() => {});
        jsonlexists.mockImplementation(() => false);
        listCollectionIndexes.mockImplementation(() => Object.keys(indexes));
        viewIndexConfig.mockImplementation(
            (_, indexName) => indexes[indexName],
        );

        const collection = "collectionname";
        const document = "doc1";
        const documentobj = {
            prop1: "value3",
            prop2: "value4",
        };

        await expect(
            putDocument(collection, document, documentobj),
        ).rejects.toThrowError("Cannot run putDocument:Error");
    });

    test("Should throw error for deletejsonl error", async () => {
        let indexes = {
            indexone: {
                prop1: true,
            },
            indextwo: {
                prop3: true,
                prop4: true,
                prop8: false,
            },
        };

        checkCollection.mockImplementation(() => true);
        checkDocument.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        exists.mockImplementation(() => true);
        isFile.mockImplementation(() => true);
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        deletejsonl.mockImplementation(() => {
            throw new Error("Error");
        });
        editjsonlraw.mockImplementation(() => {});
        jsonlexists.mockImplementation(() => true);
        listCollectionIndexes.mockImplementation(() => Object.keys(indexes));
        viewIndexConfig.mockImplementation(
            (_, indexName) => indexes[indexName],
        );

        const collection = "collectionname";
        const document = "doc1";
        const documentobj = {
            prop1: "value3",
            prop2: "value4",
        };

        await expect(
            putDocument(collection, document, documentobj),
        ).rejects.toThrowError("Cannot run putDocument:Error");
    });

    test("Should throw error for editjsonlraw error", async () => {
        let indexes = {
            indexone: {
                prop1: true,
            },
            indextwo: {
                prop3: true,
                prop4: true,
                prop8: false,
            },
        };

        checkCollection.mockImplementation(() => true);
        checkDocument.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        exists.mockImplementation(() => true);
        isFile.mockImplementation(() => true);
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        deletejsonl.mockImplementation(() => {});
        editjsonlraw.mockImplementation(() => {
            throw new Error("Error");
        });
        jsonlexists.mockImplementation(() => true);
        listCollectionIndexes.mockImplementation(() => Object.keys(indexes));
        viewIndexConfig.mockImplementation(
            (_, indexName) => indexes[indexName],
        );

        const collection = "collectionname";
        const document = "doc1";
        const documentobj = {
            prop1: "value3",
            prop2: "value4",
        };

        await expect(
            putDocument(collection, document, documentobj),
        ).rejects.toThrowError("Cannot run putDocument:Error");
    });

    test("Should throw error for jsonlexists error", async () => {
        let indexes = {
            indexone: {
                prop1: true,
            },
            indextwo: {
                prop3: true,
                prop4: true,
                prop8: false,
            },
        };

        checkCollection.mockImplementation(() => true);
        checkDocument.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        exists.mockImplementation(() => true);
        isFile.mockImplementation(() => true);
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        deletejsonl.mockImplementation(() => {});
        editjsonlraw.mockImplementation(() => {});
        jsonlexists.mockImplementation(() => {
            throw new Error("Error");
        });
        listCollectionIndexes.mockImplementation(() => Object.keys(indexes));
        viewIndexConfig.mockImplementation(
            (_, indexName) => indexes[indexName],
        );

        const collection = "collectionname";
        const document = "doc1";
        const documentobj = {
            prop1: "value3",
            prop2: "value4",
        };

        await expect(
            putDocument(collection, document, documentobj),
        ).rejects.toThrowError("Cannot run putDocument:Error");
    });

    test("Should throw error for listCollectionIndexes error", async () => {
        let indexes = {
            indexone: {
                prop1: true,
            },
            indextwo: {
                prop3: true,
                prop4: true,
                prop8: false,
            },
        };

        checkCollection.mockImplementation(() => true);
        checkDocument.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        exists.mockImplementation(() => true);
        isFile.mockImplementation(() => true);
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        deletejsonl.mockImplementation(() => {});
        editjsonlraw.mockImplementation(() => {});
        jsonlexists.mockImplementation(() => false);
        listCollectionIndexes.mockImplementation(() => {
            throw new Error("Error");
        });
        viewIndexConfig.mockImplementation(
            (_, indexName) => indexes[indexName],
        );

        const collection = "collectionname";
        const document = "doc1";
        const documentobj = {
            prop1: "value3",
            prop2: "value4",
        };

        await expect(
            putDocument(collection, document, documentobj),
        ).rejects.toThrowError("Cannot run putDocument:Error");
    });

    test("Should throw error for viewIndexConfig error", async () => {
        let indexes = {
            indexone: {
                prop1: true,
            },
            indextwo: {
                prop3: true,
                prop4: true,
                prop8: false,
            },
        };

        checkCollection.mockImplementation(() => true);
        checkDocument.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        exists.mockImplementation(() => true);
        isFile.mockImplementation(() => true);
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        deletejsonl.mockImplementation(() => {});
        editjsonlraw.mockImplementation(() => {});
        jsonlexists.mockImplementation(() => false);
        listCollectionIndexes.mockImplementation(() => Object.keys(indexes));
        viewIndexConfig.mockImplementation(() => {
            throw new Error("Error");
        });

        const collection = "collectionname";
        const document = "doc1";
        const documentobj = {
            prop1: "value3",
            prop2: "value4",
        };

        await expect(
            putDocument(collection, document, documentobj),
        ).rejects.toThrowError("Cannot run putDocument:Error");
    });
});
