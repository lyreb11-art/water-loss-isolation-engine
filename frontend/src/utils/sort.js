/**
 * Natural sort for street names.
 * Handles "1st Road" < "2nd Road" < ... < "10th Road" < "23rd Road"
 * and "1st Cross Road" < "1st Road".
 */
export function naturalSortStreets(arr) {
    return [...arr].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    )
}