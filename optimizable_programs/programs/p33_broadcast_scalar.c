/* 33. Loop-invariant value broadcast
 * The scalar k is broadcast to every vector lane.
 */
void add_const(int * restrict a, int * restrict b, int k, int n) {
    for (int i = 0; i < n; i++) a[i] = b[i] + k * 3;
}
