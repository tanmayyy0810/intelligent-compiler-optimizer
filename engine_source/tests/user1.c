bool numbersMatch(int a, int b) { return a == b; }
int main() {
    int arr[] = {4, 2, 7, 2, 8, 4, 9, 1};
    int size = sizeof(arr) / sizeof(arr[0]);
    int duplicateCount = 0;
    for (int i = 0; i < size; i++) {
        for (int j = i + 1; j < size; j++) {
            if (numbersMatch(arr[i], arr[j])) {
                printf("Found duplicate: %d\n", arr[i]);
                duplicateCount++;
            }
        }
    }
    printf("Total duplicate pairs found: %d\n", duplicateCount);
    return 0;
}
