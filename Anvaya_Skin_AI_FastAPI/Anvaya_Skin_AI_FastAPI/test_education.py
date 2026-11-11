from app.education.skin_lesion_content import (
    get_education_content,
    get_supported_classes
)

print("Supported classes:")
print(get_supported_classes())

print("\nEnglish content:")
print(get_education_content("mel", "en"))

print("\nHindi content:")
print(get_education_content("mel", "hi"))

print("\nTesting all seven classes:")

for code in get_supported_classes():
    result = get_education_content(code, "en")
    assert result["doctor_review_required"] is True
    assert result["sources"]

    print(code, ":", result["title"], "| PASS")

print("\nAll education module tests passed!")