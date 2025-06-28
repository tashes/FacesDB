import { vi, beforeEach, describe, test, expect } from "vitest";
import { createDocument } from "../../lib/createDocument";

let checkCollection = vi.spyOn(
    await import("../../utils/checks"),
    "checkCollection",
);
let checkDocumentobj = vi.spyOn(
    await import("../../utils/checks"),
    "checkDocumentobj",
);
let newid = vi.spyOn(await import("../../utils/ids"), "newid");
let writejson = vi.spyOn(await import("../../utils/fs"), "writejson");
let appendjsonl = vi.spyOn(await import("../../utils/fs"), "appendjsonl");
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
    checkDocumentobj.mockClear();
    newid.mockClear();
    writejson.mockClear();
    appendjsonl.mockClear();
    listCollectionIndexes.mockClear();
    viewIndexConfig.mockClear();
});

describe("Normal run", () => {
    test("Should save document and save it to the correct indexes", async () => {
        let indexes = {
            indexone: {
                prop1: true,
                prop2: true,
                prop3: false,
            },
            indextwo: {
                prop1: true,
                prop2: false,
                prop4: false,
            },
            indexthree: {
                prop8: true,
                prop9: false,
            },
        };

        checkCollection.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        newid.mockImplementation(() => "85a71125F2B7CA61F58DdA0B");
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        listCollectionIndexes.mockImplementation(() => [
            "indexone",
            "indextwo",
            "indexthree",
        ]);
        viewIndexConfig.mockImplementation((_, index) => indexes[index]);

        let collection = "collectionname";
        let documentobj = {
            prop1: "HELLO",
            prop2: 2,
            prop3: true,
            prop4: [200, 3384, 48, 909084],
            prop5: {
                a: "A",
                x: "X",
                e: "E",
            },
        };

        await createDocument(collection, documentobj);

        expect(writejson).toHaveBeenCalledWith(
            { ...documentobj, _id: "85a71125F2B7CA61F58DdA0B" },
            "collectionname",
            "85a71125F2B7CA61F58DdA0B.json",
        );
        expect(appendjsonl).toHaveBeenCalledTimes(2);
        expect(appendjsonl).toHaveBeenNthCalledWith(
            1,
            {
                _id: "85a71125F2B7CA61F58DdA0B",
                prop1: "HELLO",
                prop2: 2,
                prop3: true,
            },
            "collectionname",
            "indexone.jsonl",
        );
        expect(appendjsonl).toHaveBeenNthCalledWith(
            2,
            {
                _id: "85a71125F2B7CA61F58DdA0B",
                prop1: "HELLO",
                prop2: 2,
                prop4: [200, 3384, 48, 909084],
            },
            "collectionname",
            "indextwo.jsonl",
        );
    });
});

describe("Initialization error", () => {
    test("Should throw error for invalid collection", async () => {
        let indexes = {
            indexone: {
                prop1: true,
                prop2: true,
                prop3: false,
            },
            indextwo: {
                prop1: true,
                prop2: false,
                prop4: false,
            },
            indexthree: {
                prop8: true,
                prop9: false,
            },
        };

        checkCollection.mockImplementation(() => new Error("Error"));
        checkDocumentobj.mockImplementation(() => true);
        newid.mockImplementation(() => "85a71125F2B7CA61F58DdA0B");
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        listCollectionIndexes.mockImplementation(() => [
            "indexone",
            "indextwo",
            "indexthree",
        ]);
        viewIndexConfig.mockImplementation((_, index) => indexes[index]);

        let collection = "collectionname";
        let documentobj = {
            prop1: "HELLO",
            prop2: 2,
            prop3: true,
            prop4: [200, 3384, 48, 909084],
            prop5: {
                a: "A",
                x: "X",
                e: "E",
            },
        };

        await expect(() =>
            createDocument(collection, documentobj),
        ).rejects.toThrowError("Cannot start createDocument:Error");
    });

    test("Should throw error for invalid documentobj", async () => {
        let indexes = {
            indexone: { prop1: true, prop2: true, prop3: false },
            indextwo: { prop1: true, prop2: false, prop4: false },
            indexthree: { prop8: true, prop9: false },
        };

        checkCollection.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => new Error("Error"));
        newid.mockImplementation(() => "85a71125F2B7CA61F58DdA0B");
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        listCollectionIndexes.mockImplementation(() => [
            "indexone",
            "indextwo",
            "indexthree",
        ]);
        viewIndexConfig.mockImplementation((_, index) => indexes[index]);

        let collection = "collectionname";
        let documentobj = {
            prop1: "HELLO",
            prop2: 2,
            prop3: true,
            prop4: [200, 3384, 48, 909084],
            prop5: { a: "A", x: "X", e: "E" },
        };

        await expect(
            createDocument(collection, documentobj),
        ).rejects.toThrowError("Cannot start createDocument:Error");
    });
});

describe("Function errors", () => {
    test("Should throw error for newid error", async () => {
        let indexes = {
            indexone: {
                prop1: true,
                prop2: true,
                prop3: false,
            },
            indextwo: {
                prop1: true,
                prop2: false,
                prop4: false,
            },
            indexthree: {
                prop8: true,
                prop9: false,
            },
        };

        checkCollection.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        newid.mockImplementation(() => {
            throw new Error("Error");
        });
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        listCollectionIndexes.mockImplementation(() => [
            "indexone",
            "indextwo",
            "indexthree",
        ]);
        viewIndexConfig.mockImplementation((_, index) => indexes[index]);

        let collection = "collectionname";
        let documentobj = {
            prop1: "HELLO",
            prop2: 2,
            prop3: true,
            prop4: [200, 3384, 48, 909084],
            prop5: {
                a: "A",
                x: "X",
                e: "E",
            },
        };

        await expect(() =>
            createDocument(collection, documentobj),
        ).rejects.toThrowError("Cannot run createDocument:Error");
    });

    test("Should throw error for writejson error", async () => {
        let indexes = {
            indexone: { prop1: true, prop2: true, prop3: false },
            indextwo: { prop1: true, prop2: false, prop4: false },
            indexthree: { prop8: true, prop9: false },
        };

        checkCollection.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        newid.mockImplementation(() => "85a71125F2B7CA61F58DdA0B");
        writejson.mockImplementation(() => {
            throw new Error("Error");
        });
        appendjsonl.mockImplementation(() => {});
        listCollectionIndexes.mockImplementation(() => [
            "indexone",
            "indextwo",
            "indexthree",
        ]);
        viewIndexConfig.mockImplementation((_, index) => indexes[index]);

        let collection = "collectionname";
        let documentobj = {
            prop1: "HELLO",
            prop2: 2,
            prop3: true,
            prop4: [200, 3384, 48, 909084],
            prop5: { a: "A", x: "X", e: "E" },
        };

        await expect(
            createDocument(collection, documentobj),
        ).rejects.toThrowError("Cannot run createDocument:Error");
    });

    test("Should throw error for appendjsonl error", async () => {
        let indexes = {
            indexone: { prop1: true, prop2: true, prop3: false },
            indextwo: { prop1: true, prop2: false, prop4: false },
            indexthree: { prop8: true, prop9: false },
        };

        checkCollection.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        newid.mockImplementation(() => "85a71125F2B7CA61F58DdA0B");
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {
            throw new Error("Error");
        });
        listCollectionIndexes.mockImplementation(() => [
            "indexone",
            "indextwo",
            "indexthree",
        ]);
        viewIndexConfig.mockImplementation((_, index) => indexes[index]);

        let collection = "collectionname";
        let documentobj = {
            prop1: "HELLO",
            prop2: 2,
            prop3: true,
            prop4: [200, 3384, 48, 909084],
            prop5: { a: "A", x: "X", e: "E" },
        };

        await expect(
            createDocument(collection, documentobj),
        ).rejects.toThrowError("Cannot run createDocument:Error");
    });

    test("Should throw error for listCollectionIndexes error", async () => {
        let indexes = {
            indexone: { prop1: true, prop2: true, prop3: false },
            indextwo: { prop1: true, prop2: false, prop4: false },
            indexthree: { prop8: true, prop9: false },
        };

        checkCollection.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        newid.mockImplementation(() => "85a71125F2B7CA61F58DdA0B");
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        listCollectionIndexes.mockImplementation(() => {
            throw new Error("Error");
        });
        viewIndexConfig.mockImplementation((_, index) => indexes[index]);

        let collection = "collectionname";
        let documentobj = {
            prop1: "HELLO",
            prop2: 2,
            prop3: true,
            prop4: [200, 3384, 48, 909084],
            prop5: { a: "A", x: "X", e: "E" },
        };

        await expect(
            createDocument(collection, documentobj),
        ).rejects.toThrowError("Cannot run createDocument:Error");
    });

    test("Should throw error for viewIndexConfig error", async () => {
        let indexes = {
            indexone: { prop1: true, prop2: true, prop3: false },
            indextwo: { prop1: true, prop2: false, prop4: false },
            indexthree: { prop8: true, prop9: false },
        };

        checkCollection.mockImplementation(() => true);
        checkDocumentobj.mockImplementation(() => true);
        newid.mockImplementation(() => "85a71125F2B7CA61F58DdA0B");
        writejson.mockImplementation(() => {});
        appendjsonl.mockImplementation(() => {});
        listCollectionIndexes.mockImplementation(() => [
            "indexone",
            "indextwo",
            "indexthree",
        ]);
        viewIndexConfig.mockImplementation(() => {
            throw new Error("Error");
        });

        let collection = "collectionname";
        let documentobj = {
            prop1: "HELLO",
            prop2: 2,
            prop3: true,
            prop4: [200, 3384, 48, 909084],
            prop5: { a: "A", x: "X", e: "E" },
        };

        await expect(
            createDocument(collection, documentobj),
        ).rejects.toThrowError("Cannot run createDocument:Error");
    });
});
