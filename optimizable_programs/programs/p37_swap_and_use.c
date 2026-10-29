/* 37. Swap two numbers
 * Pointer swap through a helper with &x, followed by constant arithmetic.
 */
int main() {
    int x = 3, y = 7;
    int t = x;
    x = y;
    y = t;
    printf("x=%d y=%d\n", x, y);
    return x * 10 + y;
}
