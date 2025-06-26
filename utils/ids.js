import { crypto } from "crypto";

export function newid() {
    const id = crypto.randomBytes(12).toString("hex");
    return id;
}
