/* 46. Short-circuit guard that never divides by zero
 * With real short-circuit evaluation the right-hand division is never executed when the left side is false, so folding removes it safely.
 */
int main() {
    int a = 0;
    if (a != 0 && 100 / a > 1) {
        return 1;
    }
    return 2;
}
