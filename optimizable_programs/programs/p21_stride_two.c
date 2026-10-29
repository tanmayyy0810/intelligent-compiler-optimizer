/* 21. Stride-2 loop
 * Non-unit stride rules out vectorization but not unrolling.
 */
void double_even(int *a, int n) {
    for (int i = 0; i < n; i += 2) a[i] = a[i] * 2;
}
