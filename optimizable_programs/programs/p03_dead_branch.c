/* 03. Debug flag that is always off
 * A constant condition makes one side of an if/else unreachable; it is removed.
 */
int main() {
    int debug = 0;
    int result = 10;
    if (debug) {
        printf("debug: result=%d\n", result);
        result = result * 100;
    } else {
        result = result + 1;
    }
    return result;
}
