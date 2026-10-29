/* 38. Chain of copies
 * b = a; c = b + 1: every use of a copy is replaced by the original value and the dead copies disappear.
 */
int copies(int n) {
    int a = n;
    int b = a;
    int c = b + 1;
    return c * b;
}
