/* 04. Algebraic identities
 * x+0, x*1 and x*0 are simplified without knowing x.
 */
int simplify(int x) {
    int a = x + 0;
    int b = a * 1;
    int c = b * 0;
    return a + b + c;
}
