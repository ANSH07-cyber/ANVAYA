
"""
Anvaya - Patient Education Content

Educational information for the seven HAM10000 image categories.
This content is informational only and must not be treated as a diagnosis.
"""

SUPPORTED_CLASSES = [
    "akiec",
    "bcc",
    "bkl",
    "df",
    "mel",
    "nv",
    "vasc"
]

GLOBAL_CAUSE_NOTE = {
    "en": (
        "An image classification model cannot determine why a particular "
        "person developed a skin lesion. Personal history, clinical "
        "examination and, when appropriate, further medical tests are "
        "needed to understand an individual case."
    ),
    "hi": (
        "AI image model kisi particular vyakti mein skin lesion hone "
        "ka exact karan nahi bata sakta. Iske liye personal medical "
        "history, doctor ki examination aur zarurat padne par "
        "additional medical tests ki avashyakta hoti hai."
    )
}

GLOBAL_DISCLAIMER = {
    "en": (
        "This is an AI-assisted educational result, not a confirmed "
        "diagnosis. The prediction must be reviewed by a qualified "
        "dermatologist. Do not start or stop treatment based on this "
        "prediction alone."
    ),
    "hi": (
        "Yeh AI ki madad se diya gaya educational result hai, "
        "confirmed diagnosis nahi. Is result ko qualified dermatologist "
        "se review karwana zaroori hai. Sirf AI prediction ke aadhar "
        "par treatment shuru ya band na karein."
    )
}


SKIN_LESION_EDUCATION = {

    # 1. AKIEC
    "akiec": {
        "title": {
            "en": "Actinic Keratosis / Intraepithelial Carcinoma",
            "hi": "Actinic Keratosis / Intraepithelial Carcinoma"
        },

        "what_it_means": {
            "en": (
                "AKIEC is a combined category in the HAM10000 dataset. "
                "It includes actinic keratoses and intraepithelial "
                "carcinoma, also known as Bowen's disease. These are "
                "different types of skin lesions, so this prediction "
                "does not identify the exact subtype."
            ),
            "hi": (
                "AKIEC HAM10000 dataset ki ek combined category hai. "
                "Ismein Actinic Keratosis aur Intraepithelial Carcinoma, "
                "jise Bowen's disease bhi kaha jata hai, shamil hain. "
                "Yeh alag-alag skin lesions hain, isliye AI result "
                "exact subtype confirm nahi karta."
            )
        },

        "general_background": {
            "en": (
                "Actinic keratosis is commonly associated with long-term "
                "ultraviolet (UV) exposure. Bowen's disease can have "
                "different causes, so the cause cannot be assumed "
                "from this image result."
            ),
            "hi": (
                "Actinic Keratosis ka sambandh aksar lambe samay tak "
                "UV exposure se hota hai. Bowen's disease ke alag "
                "karan ho sakte hain. Isliye image result se exact "
                "cause assume nahi karna chahiye."
            )
        },

        "when_to_seek_care": {
            "en": (
                "Arrange a dermatologist review, especially if the "
                "spot is growing, changing, rough, scaling or bleeding."
            ),
            "hi": (
                "Dermatologist se check-up karwayein, khaaskar agar "
                "spot badh raha ho, appearance badal raha ho, rough "
                "ho ya bleeding ho."
            )
        },

        "next_steps": {
            "en": (
                "A dermatologist can examine the lesion and decide "
                "whether dermoscopy, biopsy or another examination "
                "is appropriate."
            ),
            "hi": (
                "Dermatologist lesion ki examination karke decide "
                "kar sakte hain ki dermoscopy, biopsy ya kisi aur "
                "test ki zarurat hai ya nahi."
            )
        },

        "sources": [
            {
                "name": "HAM10000 Original Research Paper",
                "url": "https://doi.org/10.1038/sdata.2018.161"
            }
        ]
    },


    # 2. BCC
    "bcc": {
        "title": {
            "en": "Basal Cell Carcinoma",
            "hi": "Basal Cell Carcinoma"
        },

        "what_it_means": {
            "en": (
                "Basal cell carcinoma is a type of skin cancer that "
                "starts in basal cells of the skin. It often grows "
                "slowly, but it can damage nearby tissue if left "
                "untreated. An AI prediction does not confirm that "
                "a person has this condition."
            ),
            "hi": (
                "Basal Cell Carcinoma skin cancer ka ek type hai, "
                "jo skin ki basal cells mein shuru hota hai. "
                "Yeh aksar dheere badhta hai, lekin treatment na "
                "milne par aas-paas ke tissue ko nuksan pahuncha "
                "sakta hai. AI prediction is disease ko confirm "
                "nahi karta."
            )
        },

        "general_background": {
            "en": (
                "Long-term UV exposure from sunlight and indoor "
                "tanning devices is an important general risk factor. "
                "Other personal and medical factors may also influence "
                "risk."
            ),
            "hi": (
                "Sunlight aur indoor tanning devices se milne wala "
                "lambe samay ka UV exposure ek important general "
                "risk factor hai. Personal aur medical factors bhi "
                "risk ko affect kar sakte hain."
            )
        },

        "when_to_seek_care": {
            "en": (
                "Arrange dermatologist assessment if a spot does "
                "not heal, repeatedly bleeds or forms a recurring "
                "sore or unusual growth."
            ),
            "hi": (
                "Agar koi spot theek nahi ho raha, baar-baar bleeding "
                "ho rahi hai ya wound baar-baar ban raha hai, toh "
                "dermatologist se examination karwayein."
            )
        },

        "next_steps": {
            "en": (
                "Consult a dermatologist for examination and "
                "confirmation. Treatment decisions depend on the "
                "actual diagnosis and clinical assessment."
            ),
            "hi": (
                "Examination aur confirmation ke liye dermatologist "
                "se consult karein. Treatment ka decision actual "
                "diagnosis aur medical examination par depend karta hai."
            )
        },

        "sources": [
            {
                "name": "American Academy of Dermatology - BCC",
                "url": "https://www.aad.org/public/diseases/skin-cancer/basal-cell-carcinoma"
            },
            {
                "name": "National Cancer Institute - Skin Cancer",
                "url": "https://www.cancer.gov/types/skin"
            }
        ]
    },


    # 3. BKL
    "bkl": {
        "title": {
            "en": "Benign Keratosis-Like Lesions",
            "hi": "Benign Keratosis-Like Lesions"
        },

        "what_it_means": {
            "en": (
                "BKL is a broad group in HAM10000. It includes "
                "seborrheic keratoses, solar lentigines and "
                "lichen-planus-like keratoses. The AI category "
                "does not identify which exact subtype is present."
            ),
            "hi": (
                "BKL HAM10000 mein ek broad category hai. Ismein "
                "Seborrheic Keratosis, Solar Lentigo aur "
                "Lichen-Planus-Like Keratosis shamil hain. AI "
                "prediction exact subtype identify nahi karta."
            )
        },

        "general_background": {
            "en": (
                "These subtypes have different characteristics and "
                "background factors. Some can have visual patterns "
                "that resemble other skin lesions. The category "
                "alone cannot establish the exact condition."
            ),
            "hi": (
                "Is group ke alag subtypes ki characteristics aur "
                "background factors alag ho sakte hain. Kuch lesions "
                "dekhne mein doosre skin lesions jaise lag sakte hain. "
                "Sirf AI category se exact condition confirm nahi hoti."
            )
        },

        "when_to_seek_care": {
            "en": (
                "Seek medical assessment if the spot is new, changing, "
                "irritated, bleeding or looks different from your "
                "other skin spots."
            ),
            "hi": (
                "Agar spot naya hai, badal raha hai, irritated hai, "
                "bleeding ho rahi hai ya doosre spots se alag dikh raha "
                "hai, toh doctor se examination karwayein."
            )
        },

        "next_steps": {
            "en": (
                "A dermatologist should confirm the actual lesion "
                "type. Do not assume that every BKL prediction "
                "represents the same skin condition."
            ),
            "hi": (
                "Dermatologist se actual lesion type confirm karwayein. "
                "Har BKL prediction ko ek hi skin condition nahi "
                "samajhna chahiye."
            )
        },

        "sources": [
            {
                "name": "HAM10000 Original Research Paper",
                "url": "https://doi.org/10.1038/sdata.2018.161"
            }
        ]
    },


    # 4. DF
    "df": {
        "title": {
            "en": "Dermatofibroma",
            "hi": "Dermatofibroma"
        },

        "what_it_means": {
            "en": (
                "Dermatofibroma is generally a benign skin lesion. "
                "It commonly appears as a firm, small skin bump or "
                "nodule. The HAM10000 category represents this "
                "particular type of lesion."
            ),
            "hi": (
                "Dermatofibroma aam taur par ek benign skin lesion "
                "hota hai. Yeh aksar skin par ek chhote aur firm "
                "bump ya nodule ki tarah dikh sakta hai."
            )
        },

        "general_background": {
            "en": (
                "Dermatofibroma is regarded as either a benign "
                "proliferation of cells or a reactive response "
                "to minor skin trauma. The exact origin is not "
                "always clear."
            ),
            "hi": (
                "Dermatofibroma ko benign cell growth ya skin par "
                "halki chot ke baad hone wali reactive process se "
                "joda jata hai. Har individual case ka exact origin "
                "clear hona zaroori nahi hai."
            )
        },

        "when_to_seek_care": {
            "en": (
                "Arrange an examination if the bump grows, changes "
                "rapidly, becomes painful, bleeds or does not match "
                "its previous appearance."
            ),
            "hi": (
                "Agar bump badhne lage, jaldi appearance badle, "
                "dard ho, bleeding ho ya pehle jaisa na dikhe, "
                "toh doctor se check karwayein."
            )
        },

        "next_steps": {
            "en": (
                "A dermatologist can confirm whether the lesion is "
                "consistent with dermatofibroma and decide whether "
                "any further evaluation is needed."
            ),
            "hi": (
                "Dermatologist confirm kar sakte hain ki lesion "
                "Dermatofibroma jaisa hai ya nahi aur additional "
                "examination ki zarurat hai ya nahi."
            )
        },

        "sources": [
            {
                "name": "DermNet - Dermatofibroma",
                "url": "https://dermnetnz.org/topics/dermatofibroma"
            },
            {
                "name": "HAM10000 Original Research Paper",
                "url": "https://doi.org/10.1038/sdata.2018.161"
            }
        ]
    },


    # 5. MEL
    "mel": {
        "title": {
            "en": "Melanoma",
            "hi": "Melanoma"
        },

        "what_it_means": {
            "en": (
                "Melanoma is a type of skin cancer that develops "
                "from melanocytes, the cells that produce skin pigment. "
                "The model's MEL prediction is an image-classification "
                "result, not confirmation that melanoma is present."
            ),
            "hi": (
                "Melanoma skin cancer ka ek type hai jo melanocytes "
                "mein develop hota hai. Melanocytes woh cells hain "
                "jo skin ko pigment dete hain. AI ka MEL result "
                "sirf image prediction hai, confirmed diagnosis nahi."
            )
        },

        "general_background": {
            "en": (
                "General melanoma risk factors can include UV exposure, "
                "previous severe sunburn, a personal or family history "
                "of melanoma and certain types of atypical moles. "
                "These factors do not establish the cause of an "
                "individual lesion."
            ),
            "hi": (
                "Melanoma ke general risk factors mein UV exposure, "
                "severe sunburn, personal ya family history aur "
                "kuch atypical moles shamil ho sakte hain. Yeh factors "
                "kisi individual lesion ka exact cause prove nahi karte."
            )
        },

        "when_to_seek_care": {
            "en": (
                "Arrange prompt dermatologist assessment, especially "
                "if a spot is new or changing. Warning signs can "
                "include asymmetry, irregular borders, varied colours, "
                "change in size or appearance, itching or bleeding."
            ),
            "hi": (
                "Jaldi dermatologist se examination karwayein, "
                "khaaskar agar spot naya hai ya badal raha hai. "
                "Warning signs mein uneven shape, irregular border, "
                "alag-alag colours, size ya appearance mein badlav, "
                "itching ya bleeding shamil ho sakte hain."
            )
        },

        "next_steps": {
            "en": (
                "Do not rely on the AI score to rule melanoma in "
                "or out. A dermatologist should examine the lesion "
                "and decide whether dermoscopy or biopsy is needed."
            ),
            "hi": (
                "Melanoma confirm ya rule out karne ke liye AI score "
                "par depend na karein. Dermatologist lesion examine "
                "karke decide karenge ki dermoscopy ya biopsy ki "
                "zarurat hai ya nahi."
            )
        },

        "sources": [
            {
                "name": "American Academy of Dermatology - ABCDEs of Melanoma",
                "url": "https://www.aad.org/public/diseases/skin-cancer/abcdes-melanoma"
            },
            {
                "name": "National Cancer Institute - Melanoma Risk Factors",
                "url": "https://www.cancer.gov/types/skin"
            },
            {
                "name": "HAM10000 Original Research Paper",
                "url": "https://doi.org/10.1038/sdata.2018.161"
            }
        ]
    },


    # 6. NV
    "nv": {
        "title": {
            "en": "Melanocytic Nevus (Common Mole)",
            "hi": "Melanocytic Nevus (Common Mole)"
        },

        "what_it_means": {
            "en": (
                "A melanocytic nevus is commonly called a mole. "
                "It is generally a benign growth of melanocytes, "
                "the cells responsible for skin pigment. Moles "
                "can vary in colour, shape and size."
            ),
            "hi": (
                "Melanocytic Nevus ko aam bhasha mein mole ya til "
                "kaha jata hai. Yeh aam taur par melanocytes ka "
                "benign growth hota hai. Moles ka colour, shape "
                "aur size alag-alag ho sakta hai."
            )
        },

        "general_background": {
            "en": (
                "Moles may be present from birth or develop later "
                "in life. Their number and appearance can be "
                "influenced by several personal and environmental "
                "factors. An AI result cannot determine why a "
                "particular mole developed."
            ),
            "hi": (
                "Moles janm se ho sakte hain ya baad mein develop "
                "ho sakte hain. Inki sankhya aur appearance par "
                "kai personal aur environmental factors ka asar "
                "ho sakta hai. AI kisi specific mole ka cause "
                "nahi bata sakta."
            )
        },

        "when_to_seek_care": {
            "en": (
                "Consult a dermatologist if a mole is new, changes "
                "in size, shape or colour, looks different from "
                "your other moles, itches or bleeds."
            ),
            "hi": (
                "Agar mole naya hai, size, shape ya colour badal raha "
                "hai, doosre moles se alag dikh raha hai, itching "
                "ya bleeding hai, toh dermatologist se milen."
            )
        },

        "next_steps": {
            "en": (
                "A dermatologist can examine the mole and decide "
                "whether monitoring, dermoscopy or another "
                "assessment is required."
            ),
            "hi": (
                "Dermatologist mole ko examine karke decide karenge "
                "ki monitoring, dermoscopy ya kisi additional "
                "assessment ki zarurat hai ya nahi."
            )
        },

        "sources": [
            {
                "name": "American Academy of Dermatology - Moles",
                "url": "https://www.aad.org/public/diseases/a-z/moles-symptoms"
            },
            {
                "name": "National Cancer Institute - Common Moles",
                "url": "https://www.cancer.gov/types/skin/moles-fact-sheet"
            }
        ]
    },


    # 7. VASC
    "vasc": {
        "title": {
            "en": "Vascular Skin Lesions",
            "hi": "Vascular Skin Lesions"
        },

        "what_it_means": {
            "en": (
                "VASC is a broad dataset category for vascular "
                "skin lesions. HAM10000 includes examples such as "
                "cherry angiomas, angiokeratomas, pyogenic granulomas "
                "and haemorrhage. The prediction does not identify "
                "the exact subtype."
            ),
            "hi": (
                "VASC vascular skin lesions ki ek broad category "
                "hai. HAM10000 mein Cherry Angioma, Angiokeratoma, "
                "Pyogenic Granuloma aur haemorrhage jaise examples "
                "shamil hain. AI result exact subtype identify "
                "nahi karta."
            )
        },

        "general_background": {
            "en": (
                "Different vascular lesion subtypes have different "
                "backgrounds. Some involve small blood vessels, "
                "while others may be associated with irritation, "
                "trauma or other processes. The exact reason cannot "
                "be inferred from the image classification."
            ),
            "hi": (
                "Vascular lesions ke alag subtypes ke background "
                "alag ho sakte hain. Kuch chhoti blood vessels se "
                "related hote hain, jabki kuch irritation, trauma "
                "ya doosri processes se jude ho sakte hain. Image "
                "prediction se exact reason nahi pata chalta."
            )
        },

        "when_to_seek_care": {
            "en": (
                "Seek medical assessment if the area grows quickly, "
                "bleeds repeatedly, becomes painful or does not heal."
            ),
            "hi": (
                "Agar area jaldi badhta hai, baar-baar bleeding hoti "
                "hai, dard hota hai ya heal nahi hota, toh medical "
                "assessment karwayein."
            )
        },

        "next_steps": {
            "en": (
                "A dermatologist can identify the actual type of "
                "vascular lesion and determine whether any "
                "additional examination is required."
            ),
            "hi": (
                "Dermatologist vascular lesion ka actual type "
                "identify karke decide kar sakte hain ki additional "
                "examination ki zarurat hai ya nahi."
            )
        },

        "sources": [
            {
                "name": "HAM10000 Original Research Paper",
                "url": "https://doi.org/10.1038/sdata.2018.161"
            },
            {
                "name": "DermNet - Benign Skin Lesions",
                "url": "https://dermnetnz.org/topics/benign-skin-lesions"
            }
        ]
    }
}


def get_education_content(class_code: str, language: str = "en") -> dict:
    """
    Return patient-friendly education for one supported HAM10000 class.

    Args:
        class_code: Predicted class such as 'mel', 'bcc' or 'nv'.
        language: 'en' for English or 'hi' for Hindi.

    Returns:
        A dictionary containing educational content and safety notes.

    Raises:
        ValueError: If the class code or language is unsupported.
    """

    if not isinstance(class_code, str):
        raise ValueError("Class code must be a string.")

    code = class_code.strip().lower()

    if code not in SKIN_LESION_EDUCATION:
        raise ValueError(f"Unsupported skin lesion class: {code}")

    if not isinstance(language, str):
        raise ValueError("Language must be a string.")

    lang = language.strip().lower()

    if lang not in ("en", "hi"):
        raise ValueError("Supported languages are 'en' and 'hi'.")

    content = SKIN_LESION_EDUCATION[code]

    return {
        "class_code": code,
        "title": content["title"][lang],
        "what_it_means": content["what_it_means"][lang],
        "general_background": content["general_background"][lang],
        "why_the_cause_cannot_be_confirmed": GLOBAL_CAUSE_NOTE[lang],
        "when_to_seek_care": content["when_to_seek_care"][lang],
        "next_steps": content["next_steps"][lang],
        "doctor_review_required": True,
        "disclaimer": GLOBAL_DISCLAIMER[lang],
        "sources": content["sources"]
    }


def get_supported_classes() -> list:
    """Return the seven supported model class codes."""
    return SUPPORTED_CLASSES.copy()
