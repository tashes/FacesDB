import { expect } from "chai";
import { COLLECTIONNAME, DOCUMENTID, INDEXNAME } from "./constants.js";
import { List } from "./errors.js";

export function isDefined(value) {
    try {
        expect(value).to.not.be.undefined;
    } catch (e) {
        return false;
    }
    return true;
}

export function checkCollection(value) {
    try {
        expect(value).to.be.a("string");
        expect(value).to.match(COLLECTIONNAME);
    } catch (e) {
        return e;
    }
    return true;
}

export function checkDocument(value) {
    try {
        expect(value).to.be.a("string");
        expect(value).to.match(DOCUMENTID);
    } catch (e) {
        return e;
    }
    return true;
}

export function checkDocumentobj(value) {
    try {
        expect(value).to.be.an("object");
        expect(Object.keys(value).every((key) => typeof key === "string")).to.be
            .true;
    } catch (e) {
        return e;
    }
    return true;
}

export function checkIndex(value) {
    try {
        expect(value).to.be.a("string");
        expect(value).to.match(INDEXNAME);
    } catch (e) {
        return e;
    }
    return true;
}

export function checkIndexConfig(value) {
    try {
        expect(value).to.be.an("object");
        let errors = [];
        let keys = Object.keys(value);
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            let error = checkIndexConfigKey(key);
            if (error instanceof Error) errors.push(error);
        }
        let values = Object.values(value);
        for (let i = 0; i < values.length; i++) {
            let val = values[i];
            let error = checkIndexConfigValue(val);
            if (error instanceof Error) errors.push(error);
        }
        if (errors.length > 0) throw List(errors);
    } catch (e) {
        return e;
    }
    return true;
}

export function checkIndexConfigKey(value) {
    try {
        expect(value).to.be.a("string");
    } catch (e) {
        return e;
    }
    return true;
}

export function checkIndexConfigValue(value) {
    try {
        expect(value).to.be.a("boolean");
    } catch (e) {
        return e;
    }
    return true;
}

export function checkPageNumber(value) {
    try {
        expect(value).to.be.a("number");
        expect(value).to.be.greaterThanOrEqual(0);
    } catch (e) {
        return e;
    }
    return true;
}

export function checkFn(value) {
    try {
        expect(value).to.be.a("function");
    } catch (e) {
        return e;
    }
    return true;
}
