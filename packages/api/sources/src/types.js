/**
 * Wire types of the `sources` Remote namespace. Types only: the generated
 * Remote client consumes this module without Host runtime code.
 *
 * The capability vocabulary is the resource seam's own, re-exported rather than
 * restated, so the provider that declares what a source can answer and the panel
 * that shows it name one declaration. Everything else here is what a
 * configuration surface needs and the seam does not carry: where one instance
 * stands, why its last probe failed, which settings namespace configures it, and
 * whether the credentials that configuration names are actually configured.
 *
 * Credential status is reported by reference NAME and never by value, and the
 * reference names come from the instance's own settings section — this endpoint
 * reads them through the settings provider rather than holding a copy.
 *
 * @module @deepseek-ai/dsh-api-sources/types
 */
export {};
//# sourceMappingURL=types.js.map