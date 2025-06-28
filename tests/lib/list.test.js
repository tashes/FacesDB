import { vi, beforeEach, describe, test, expect } from "vitest";
import { list } from "../../lib/list";

let readdir = vi.spyOn(await import("../../utils/fs"), "readdir");

beforeEach(() => {
    readdir.mockClear();
});

describe("Normal run", () => {
    test("Should list directory contents", async () => {
        const mockDirectoryContents = ["file1.json", "file2.json"];
        readdir.mockImplementation(() => mockDirectoryContents);

        const contents = await list();

        expect(contents).toEqual(mockDirectoryContents);
        expect(readdir).toHaveBeenCalledWith("");
    });
});

describe("Function errors", () => {
    test("Should throw error if readdir fails", async () => {
        readdir.mockImplementation(() => {
            throw new Error("Error");
        });

        await expect(list()).rejects.toThrowError("Cannot run list:Error");
    });
});
