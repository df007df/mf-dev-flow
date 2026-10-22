import { publicationResult } from "./publisher.mjs";

export const nullPublisher = Object.freeze({
  enabled: false,
  publish() {
    return publicationResult({ state: "disabled" });
  },
});
