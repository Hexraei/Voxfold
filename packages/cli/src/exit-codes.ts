/**
 * Exit codes, kept in one place since they are a public contract (CI scripts key off them):
 *   0  clean run, nothing failed a gate
 *   1  a gate failed (--min-score / --min-file-score) or an error-severity flag was found
 *   2  the run itself could not complete: bad config, fetch failure, nothing lintable found
 */
export const EXIT_OK = 0
export const EXIT_GATE_FAILED = 1
export const EXIT_FATAL = 2
