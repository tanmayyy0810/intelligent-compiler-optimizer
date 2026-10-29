/* 27. One pointer, no restrict needed
 * Only one base pointer is accessed, so there is nothing it could alias.
 */
void scale_in_place(int *a, int n) {
    for (int i = 0; i < n; i++) a[i] = a[i] * 2 + 1;
}
