/* 20. Counting down
 * Negative step: the unroller handles i-- loops too.
 */
int sum_down(int n) {
    int s = 0;
    for (int i = n; i > 0; i--) s += i;
    return s;
}
