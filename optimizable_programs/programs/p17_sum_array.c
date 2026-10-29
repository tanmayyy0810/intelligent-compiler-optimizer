/* 17. Sum of an array (reduction)
 * A reduction cannot be vectorized here but unrolling is always order-preserving, so it is safe.
 */
int sum(int *a, int n) {
    int s = 0;
    for (int i = 0; i < n; i++) s += a[i];
    return s;
}
