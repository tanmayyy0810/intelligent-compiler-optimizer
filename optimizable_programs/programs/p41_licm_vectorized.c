/* 41. Invariant work hoisted, then vectorized
 * k*3 and k*k do not change inside the loop: they are computed once before it, and the vector loop broadcasts them.
 */
void addk(int * restrict a, int * restrict b, int k, int n) {
    for (int i = 0; i < n; i++)
        a[i] = b[i] + k * 3 + k * k;
}
