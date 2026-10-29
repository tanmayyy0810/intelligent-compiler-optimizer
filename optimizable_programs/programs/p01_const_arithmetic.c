/* 01. Constant arithmetic
 * Every operand is known at compile time, so the whole computation is evaluated by the compiler.
 */
int main() {
    int a = 2 + 3 * 4;
    int b = a * 10 - 5;
    int c = b / 5 + (b % 7);
    return c;
}
