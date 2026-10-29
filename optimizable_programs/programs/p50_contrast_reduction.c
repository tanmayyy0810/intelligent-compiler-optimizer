/* 50. Contrast: reduction is not vectorized
 * s += a[i] needs the previous s each iteration, so vectorization is rejected; unrolling still applies.
 */
int total(int * restrict a, int n) {
    int s = 0;
    for (int i = 0; i < n; i++) s += a[i];
    return s;
}
