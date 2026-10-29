/* 08. Unreachable code after return
 * Statements after a return can never run and are deleted.
 */
int pick() {
    int a = 1;
    return a + 1;
    a = 99;
    return a;
}
