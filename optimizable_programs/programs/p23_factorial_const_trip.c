/* 23. Factorial with a known trip count
 * 14 iterations: unrolled ×4 gives 3 main iterations and a 2-iteration remainder.
 */
long factorial15() {
    long r = 1;
    for (int i = 2; i <= 15; i++) r *= i;
    return r;
}
