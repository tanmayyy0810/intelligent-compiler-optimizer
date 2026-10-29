/* 34. double precision vectors
 * Same transformation on double data.
 */
void blend(double * restrict r, double * restrict a, double * restrict b, int n) {
    for (int i = 0; i < n; i++) r[i] = a[i] * 0.25 + b[i] * 0.75;
}
