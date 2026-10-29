/* 10. Nested helper calls
 * Both helpers are inlined and the result 12 is computed at compile time.
 */
int twice(int x)  { return x * 2; }
int addone(int x) { return x + 1; }
int main() {
    return twice(addone(5));
}
