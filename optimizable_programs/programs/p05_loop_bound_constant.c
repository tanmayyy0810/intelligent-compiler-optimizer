/* 05. Loop bound from a constant
 * n is a constant, so the loop bound becomes the literal 10 and the trip count is known.
 */
int sum_to_ten() {
    int n = 10;
    int s = 0;
    for (int i = 0; i < n; i++) {
        s += i;
    }
    return s;
}
