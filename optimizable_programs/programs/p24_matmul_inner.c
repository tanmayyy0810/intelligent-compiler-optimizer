/* 24. Matrix multiply, inner loop
 * The innermost k-loop is unrolled; the cache analysis also flags b[k*n+j] as a column walk.
 */
void matmul(int * restrict a, int * restrict b, int * restrict c, int n) {
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++) {
            int s = 0;
            for (int k = 0; k < n; k++)
                s += a[i * n + k] * b[k * n + j];
            c[i * n + j] = s;
        }
}
