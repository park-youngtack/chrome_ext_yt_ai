/**
 * 공용 타입 정의 (JSDoc typedef)
 */

/**
 * @typedef {Object} BatchInfo
 * @property {number} index
 * @property {number} size
 * @property {'pending'|'processing'|'completed'|'failed'} status
 */

/**
 * @typedef {Object} TranslationState
 * @property {'inactive'|'translating'|'completed'|'restored'|'error'|'cancelled'} state
 * @property {number} totalTexts
 * @property {number} translatedCount
 * @property {number} cachedCount
 * @property {number} batchCount
 * @property {number} batchesDone
 * @property {BatchInfo[]} batches
 * @property {number} activeMs
 * @property {string} originalTitle
 * @property {string} translatedTitle
 * @property {string} previewText
 */

/**
 * @typedef {Object} ProgressPayload
 * @property {TranslationState} data
 * @property {'progress'} type
 */

