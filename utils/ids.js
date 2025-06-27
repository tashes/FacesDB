import { randomBytes } from "crypto";

export function newid() {
    const id = randomBytes(12).toString("hex");
    return id;
}
