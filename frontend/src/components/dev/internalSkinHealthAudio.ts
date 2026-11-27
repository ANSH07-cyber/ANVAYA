import type { EducationLocale, EducationTopic, SkinClass } from '../skinHealth/catalog.ts';
import { sha256Hex, sha256TextHex } from '../skinHealth/verifiedPlayback.ts';

export interface InternalAudioAsset {
  id: string;
  scope: 'general' | 'category';
  category?: SkinClass | null;
  topic?: EducationTopic | null;
  locale: 'hi' | 'hi-Latn';
  contentVersion: string;
  localeRevision: string;
  clinicalReviewStatus: string;
  audio: string;
  audioSha256: string;
  textSha256: string;
  text: string;
  durationSeconds: number;
}

export const INTERNAL_SARVAM_AUDIO_ASSETS: readonly InternalAudioAsset[] = [
  {
    "id": "general-hi",
    "scope": "general",
    "category": null,
    "topic": null,
    "locale": "hi",
    "contentVersion": "skin-health-general-stage3a",
    "localeRevision": "1",
    "clinicalReviewStatus": "display_copy_in_catalog_audio_unapproved",
    "audio": "/internal-review-audio/file/library/general/hi.mp3",
    "audioSha256": "9463ff85e15c47c00cb9e556837ada39e4560cccd092bb2e16767cd9cb42754e",
    "textSha256": "e5d1b70b8c62d5e7e01d8cce779027353e805cf9cc32e5f895a8d8974745e3ed",
    "text": "एआई स्क्रीनिंग का परिणाम और डॉक्टर का आकलन अलग-अलग हैं। मॉडल से गलती हो सकती है। इसके स्कोर से स्वास्थ्य जोखिम या देखभाल की ज़रूरत कितनी जल्दी है, इसका पता नहीं चलता। त्वचा में किसी बदलाव को लेकर चिंता हो तो डॉक्टर उसका आकलन कर सकते हैं।",
    "durationSeconds": 15.867
  },
  {
    "id": "general-hi-Latn",
    "scope": "general",
    "category": null,
    "topic": null,
    "locale": "hi-Latn",
    "contentVersion": "skin-health-general-stage3a",
    "localeRevision": "1",
    "clinicalReviewStatus": "display_copy_in_catalog_audio_unapproved",
    "audio": "/internal-review-audio/file/library/general/hi-Latn.mp3",
    "audioSha256": "60154056b6e5c36a7f10c527735e3f603283af5103d965142c44b64c6fd52483",
    "textSha256": "b2705cd478424e8d928df21a9b8004a8c3da7f3669882efb3ba5f177e4fed1d9",
    "text": "AI screening ka result aur doctor ka assessment alag hain. Model se galti ho sakti hai. Iske scores se health risk ya kitni jaldi care chahiye, iska pata nahi chalta. Skin mein kisi badlav ko lekar chinta ho to doctor uska assessment kar sakte hain.",
    "durationSeconds": 14.898
  },
  {
    "id": "akiec-what-hi",
    "scope": "category",
    "category": "akiec",
    "topic": "what",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/akiec/what-hi.mp3",
    "audioSha256": "50c3e2bc39c1c89273d8e69fd37df6136de1f31f6030f6ef8bf3e894226b32bb",
    "textSha256": "7932565e1a12f70fd1bcb73963452bf81f47f278e411a65833f9387fa89d22e8",
    "text": "इस समूह में धूप से क्षतिग्रस्त ऐसे धब्बे शामिल हैं जो आगे चलकर त्वचा का कैंसर बन सकते हैं। इसमें बोवेन रोग भी आता है, जो त्वचा की ऊपरी परत तक सीमित कैंसर है। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 22.7
  },
  {
    "id": "akiec-why-hi",
    "scope": "category",
    "category": "akiec",
    "topic": "why",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/akiec/why-hi.mp3",
    "audioSha256": "ca90ad1676f16ef5c0a67e053f8628c39d4a8c2b87208206b59c86df3957a156",
    "textSha256": "64f734ff16b12942abeca1bf9c10e09c5c957c4782f5a55bcec9f4698bc2241c",
    "text": "बार-बार धूप की पराबैंगनी किरणें पड़ने से त्वचा की कोशिकाओं को नुकसान हो सकता है और ऐसे बदलावों की आशंका बढ़ सकती है। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 18.825
  },
  {
    "id": "akiec-how-hi",
    "scope": "category",
    "category": "akiec",
    "topic": "how",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/akiec/how-hi.mp3",
    "audioSha256": "797d1c5988b69e425bf75a244605c2d0dc688bbbb5745bc4d0c462e0e3a5244e",
    "textSha256": "b78c95f2cda1ae75d5ffe95ac6fda1b5cc94cbe3e36eeb8031acb1dd7fc1f84e",
    "text": "ऐक्टिनिक केराटोसिस की शुरुआत धूप लगने वाली जगह पर खुरदरे धब्बे से हो सकती है। बोवेन रोग में असामान्य कोशिकाएँ त्वचा की ऊपरी परत में बढ़ती हैं। धब्बा छूने पर रेतीला लग सकता है या उस पर पपड़ी हो सकती है। कुछ धब्बे लालिमा लिए हुए या भूरे दिखते हैं। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 27.911
  },
  {
    "id": "akiec-next-hi",
    "scope": "category",
    "category": "akiec",
    "topic": "next",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/akiec/next-hi.mp3",
    "audioSha256": "d39291621ed684eee9eeb03a25a3b86734aaf066b348a366d0cc8b91be186815",
    "textSha256": "caeef52444e0cda79ec2a98969888a0f74c065e17de1b99ce95a7781cfb13f20",
    "text": "धब्बे का मोटा होना, बढ़ना या उसमें दर्द शुरू होना ध्यान देने योग्य बदलाव हैं। खुरदरा धब्बा बना रहे या बदलने लगे तो डॉक्टर से त्वचा की जाँच कराएँ, खासकर अगर वह दुखने या बढ़ने लगे। डॉक्टर त्वचा की सतह देखते हैं। बदलाव के प्रकार या गहराई पर संदेह हो तो ऊतक के छोटे नमूने की जाँच से पहचान में मदद मिल सकती है। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 32.074
  },
  {
    "id": "akiec-what-hi-Latn",
    "scope": "category",
    "category": "akiec",
    "topic": "what",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/akiec/what-hi-Latn.mp3",
    "audioSha256": "feb843abcd3934db141b714c6a12d96fc879ca13362d02c8d8c4e5076fcf1442",
    "textSha256": "b32d475577c492322f9c3624645c1a7f45d5f3b2c5905c3040bb8c89c0423ffe",
    "text": "Is group mein dhoop se damage hue spots aate hain jinmein aage chal kar skin cancer ban sakta hai. Ismein Bowen disease bhi hai, ek cancer jo skin ki upar wali layer tak seemit hota hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 20.291
  },
  {
    "id": "akiec-why-hi-Latn",
    "scope": "category",
    "category": "akiec",
    "topic": "why",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/akiec/why-hi-Latn.mp3",
    "audioSha256": "8fb57b9410456b9863a75e0b4dcb3235a8244278f3c24e4ba80f1fcaaf9dc5f7",
    "textSha256": "368251e6378734e0d29e225ca71f37dda07219210d90b397be4360e072b03a00",
    "text": "Baar-baar dhoop ki UV kirnein padne se skin cells ko nuksan ho sakta hai aur aise badlav ka chance badh sakta hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 15.212
  },
  {
    "id": "akiec-how-hi-Latn",
    "scope": "category",
    "category": "akiec",
    "topic": "how",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/akiec/how-hi-Latn.mp3",
    "audioSha256": "a605181b1bc109796ee8599c64c1564a52e79c29023dbd1a1beabbe977bf3f4f",
    "textSha256": "b5ebc28fc1bbfe170fac11bfe9be892962a259150d239de4c717fec4ec038626",
    "text": "Actinic keratosis dhoop lagne wali jagah par khurdure patch ke roop mein shuru ho sakta hai. Bowen disease mein badle hue cells skin ki upar wali layer mein badhte hain. Patch chhoone par ret jaisa khurdura lag sakta hai ya us par papdi ho sakti hai. Kuch patches laal se ya bhoore dikhte hain. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 28.539
  },
  {
    "id": "akiec-next-hi-Latn",
    "scope": "category",
    "category": "akiec",
    "topic": "next",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/akiec/next-hi-Latn.mp3",
    "audioSha256": "8ae2fa6de816b79876e7b18b8cb4fa5c01e61b27b74c859ded3080f8414e477f",
    "textSha256": "a601c15180bad3567a4ad0c3b7383b664ce94616c88324bb927cbf79eb479273",
    "text": "Patch mota ho, badhne lage ya usmein dard shuru ho to is badlav par dhyan dein. Khurdura patch bana rahe ya badle to doctor se skin ki jaanch karayein, khaaskar agar usmein dard ho ya woh badhe. Doctor skin ki satah dekhte hain. Badlav ke type ya gehraai par doubt ho to tissue ke chhote sample ki jaanch se pehchaan mein madad mil sakti hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 31.602
  },
  {
    "id": "bcc-what-hi",
    "scope": "category",
    "category": "bcc",
    "topic": "what",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/bcc/what-hi.mp3",
    "audioSha256": "c08ff84ecdfc2e3ba20e73f8a2d2b28760779023881b6371f190850388726af2",
    "textSha256": "6f1b4ba0ab54a14c571a14a042eb9a92f1ec86028cc6a6c3813fc35eb30e2fc7",
    "text": "बेसल सेल कार्सिनोमा त्वचा का कैंसर है जो उसकी बाहरी परत के निचले हिस्से की कोशिकाओं से शुरू होता है। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 16.338
  },
  {
    "id": "bcc-why-hi",
    "scope": "category",
    "category": "bcc",
    "topic": "why",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/bcc/why-hi.mp3",
    "audioSha256": "e31768a04c36be0868e0a3391d8558ca6dfdba2a433e651477d739722d6c8285",
    "textSha256": "586e70bffc4b13d37c423f38960bb51834d484d8a3fd18ab9c0e4be3bf113e1e",
    "text": "धूप से त्वचा को नुकसान और बार-बार धूप से त्वचा झुलसने का इतिहास इसके जोखिम को बढ़ा सकते हैं। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 16.102
  },
  {
    "id": "bcc-how-hi",
    "scope": "category",
    "category": "bcc",
    "topic": "how",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/bcc/how-hi.mp3",
    "audioSha256": "4417882fd8290fd3e01102772f3e041ab90b3cae695a67f740011f3b6221ab72",
    "textSha256": "c8c0f5a4858356bbad46e8ccc0f0c8a60a64c80f2f735f0f779f191ffd544d1c",
    "text": "यह अक्सर एक जगह धीरे-धीरे बढ़ता है। समय के साथ आसपास की त्वचा को नुकसान पहुँच सकता है। यह चमकदार उभार, सपाट धब्बे या घाव जैसा दिख सकता है। इसका रंग भूरा या काला भी हो सकता है। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 22.543
  },
  {
    "id": "bcc-next-hi",
    "scope": "category",
    "category": "bcc",
    "topic": "next",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/bcc/next-hi.mp3",
    "audioSha256": "cce20259a8318bbf437ba35c5311e7b30d294668a28b6c8a858148485d9844b3",
    "textSha256": "31e85b791868bae080988bcef806b4b542f7b493103ebd22ac75d77ee123f07b",
    "text": "घाव से खून आ सकता है, उस पर पपड़ी बन सकती है और वह भरा हुआ लगने के बाद फिर खुल सकता है। बढ़ते धब्बे या बार-बार खुलने वाले या न भरने वाले घाव के लिए डॉक्टर से जाँच का समय लें। त्वचा विशेषज्ञ जगह की जाँच करते हैं और सूक्ष्मदर्शी से जाँच के लिए त्वचा का नमूना ले सकते हैं। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 31.026
  },
  {
    "id": "bcc-what-hi-Latn",
    "scope": "category",
    "category": "bcc",
    "topic": "what",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/bcc/what-hi-Latn.mp3",
    "audioSha256": "302a4c9840787ebe4c0deb5e6ff3f15f9e01a99397d05107158380bf1d7eb30f",
    "textSha256": "28ea7c58d14783d332562eff438fd6e7ac9d2e8584601aa2650d885378a0d1bf",
    "text": "Yeh skin cancer hai jo skin ki baahari layer ke nichle hisse ke cells se shuru hota hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 15.369
  },
  {
    "id": "bcc-why-hi-Latn",
    "scope": "category",
    "category": "bcc",
    "topic": "why",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/bcc/why-hi-Latn.mp3",
    "audioSha256": "796835fbf90d9983b67d7217e0bb1b4e36bb7c7751c773e9b479bf77799b6edb",
    "textSha256": "ac65e85ca32597e8f5df03d70270ebc108e7438bae72b395ebb1b35a65f0851a",
    "text": "Dhoop se skin damage aur baar-baar sunburn hone se iska risk badh sakta hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 14.505
  },
  {
    "id": "bcc-how-hi-Latn",
    "scope": "category",
    "category": "bcc",
    "topic": "how",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/bcc/how-hi-Latn.mp3",
    "audioSha256": "73c3d802e0ad7facfee02255e1b941c6d8f12138d68df1336ec156d20a1cc2a3",
    "textSha256": "1635344e867b25e4011279749d6ee455505b8b738a746677849bf09d40fabe63",
    "text": "Yeh aksar ek jagah dheere-dheere badhta hai. Samay ke saath aas-paas ki skin ko nuksan pahunch sakta hai. Yeh chamakdaar ubhaar, flat patch ya ghaav jaisa dikh sakta hai. Iska rang bhoora ya kaala bhi ho sakta hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 22.046
  },
  {
    "id": "bcc-next-hi-Latn",
    "scope": "category",
    "category": "bcc",
    "topic": "next",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/bcc/next-hi-Latn.mp3",
    "audioSha256": "2178dcb3c4ef8c9bb8aefe8b2dd4ccd3963607a2ef815dfad943853a4e89b5df",
    "textSha256": "dce0136b14a0bf8e0cacaecd927f4c84f083a23ad4cc5951853b0a48a2784849",
    "text": "Ghaav se khoon aa sakta hai, papdi ban sakti hai aur bhara hua lagne ke baad woh phir khul sakta hai. Badhte spot ya baar-baar khulne wale ya na bharne wale ghaav ki jaanch ke liye doctor se appointment lein. Skin specialist jagah ki jaanch karte hain aur microscope se dekhne ke liye skin ka sample le sakte hain. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 26.785
  },
  {
    "id": "bkl-what-hi",
    "scope": "category",
    "category": "bkl",
    "topic": "what",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/bkl/what-hi.mp3",
    "audioSha256": "f99b55d4d43d90706c8eb4b2d9b863f5169e26ec7896abc74f30e44d7485136d",
    "textSha256": "710bea4f05132cd346aea554513cea65c34a5eacbf0ebe603f86bf575350931f",
    "text": "इस समूह में कैंसर रहित कई स्थितियाँ हैं, जैसे धूप से बने धब्बे, सेबोरिक केराटोसिस और सूजन वाले धब्बे जिन्हें लाइकेनॉइड केराटोसिस कहते हैं। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 20.763
  },
  {
    "id": "bkl-why-hi",
    "scope": "category",
    "category": "bkl",
    "topic": "why",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/bkl/why-hi.mp3",
    "audioSha256": "a257d3b5466a761d088709c6e31d8b3eee8bde6cd13220d4947f395efe47a256",
    "textSha256": "1baac0d980886a0c412ce5c04fcda6b6a1683f47745fd7d7794f2287f422f138",
    "text": "धूप के धब्बों का संबंध लंबे समय तक धूप पड़ने से है। सेबोरिक केराटोसिस उम्र के साथ अधिक आम होता है और इसका सटीक कारण स्पष्ट नहीं है। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 20.763
  },
  {
    "id": "bkl-how-hi",
    "scope": "category",
    "category": "bkl",
    "topic": "how",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/bkl/how-hi.mp3",
    "audioSha256": "963a9bc8a33882caea4a6a3b7e7d1c3c67bb53a31b39d066abf881e24b95e7bd",
    "textSha256": "97089784ad23dc192b7b24969e12f405507f05c3752f67e3f75dd16cf5002044",
    "text": "एक प्रकार में पहले से मौजूद धब्बा हल्का पड़ते समय उसमें सूजन आती है। इस समूह के दूसरे धब्बों में बदलाव अलग ढंग से हो सकते हैं। कुछ धब्बे सपाट और भूरे होते हैं। कुछ उभरे हुए होते हैं और ऐसे दिखते हैं जैसे त्वचा की सतह पर चिपके हों। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 25.345
  },
  {
    "id": "bkl-next-hi",
    "scope": "category",
    "category": "bkl",
    "topic": "next",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/bkl/next-hi.mp3",
    "audioSha256": "4dd5bf6862407e4ebc1c0aaad9d19eb1be352ee9769ffd70bee3b6d1bab2a5cf",
    "textSha256": "9199eee1dc91c2307dd320b3dcc1345f59c7272ac4264e4e89179c99c4534f10",
    "text": "जो धब्बा रंग या आकार बदल रहा हो या बाकी धब्बों से अलग दिखता हो, उसकी जाँच ज़रूरी है। नए, बदलते या खून निकलने वाले धब्बे की डॉक्टर से जाँच कराएँ, भले ही मॉडल इस समूह का नाम दिखाए। त्वचा विशेषज्ञ रोशनी वाले आवर्धक यंत्र से धब्बा देख सकते हैं। वह किसी दूसरी स्थिति जैसा लगे तो ऊतक के नमूने की जाँच मदद कर सकती है। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 36.079
  },
  {
    "id": "bkl-what-hi-Latn",
    "scope": "category",
    "category": "bkl",
    "topic": "what",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/bkl/what-hi-Latn.mp3",
    "audioSha256": "ba6fe642d93157890b6bbf30d36f6bd38e509ab1b9a624de8c3ce359f8e05042",
    "textSha256": "23f1cae57af4a3d2909dd9678bbaa60e5aec47832a723b51e96abf610733f18e",
    "text": "Is group mein kai noncancerous conditions hain, jaise sun spots, seborrhoeic keratosis aur soojan wale spots jinhein lichenoid keratosis kehte hain. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 20.527
  },
  {
    "id": "bkl-why-hi-Latn",
    "scope": "category",
    "category": "bkl",
    "topic": "why",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/bkl/why-hi-Latn.mp3",
    "audioSha256": "69030634b0720a37da31dd1934bd9bc51befbfd42a838673c7c51ee1c390d23c",
    "textSha256": "e48da736061810d27a80ec95e2765c081841a627f3c83702d5eeaf500d006e68",
    "text": "Sun spots ka sambandh lambe samay tak dhoop lagne se hai. Seborrhoeic keratosis umar ke saath zyada aam hota hai aur iska exact kaaran saaf nahi hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 19.087
  },
  {
    "id": "bkl-how-hi-Latn",
    "scope": "category",
    "category": "bkl",
    "topic": "how",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/bkl/how-hi-Latn.mp3",
    "audioSha256": "7f15b1c01eca6a4cc88b5e976c6da0f57610455d9de1ead2d1fae1fe69da2f86",
    "textSha256": "a9f041211a83dff8afc7343a98f64cf66b1a0b1fc980dff51d823830e2d70e89",
    "text": "Ek type mein pehle se maujood spot halka padte waqt usmein soojan aati hai. Is group ke doosre spots alag tarah se badal sakte hain. Kuch spots flat aur bhoore hote hain. Kuch ubhre hote hain aur skin ki satah par chipke hue jaise dikhte hain. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 24.062
  },
  {
    "id": "bkl-next-hi-Latn",
    "scope": "category",
    "category": "bkl",
    "topic": "next",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/bkl/next-hi-Latn.mp3",
    "audioSha256": "60b04bc52f72f7a23a3b1b81ff3f559b2b262691d6f1164410204bed513d8a0e",
    "textSha256": "ef624ac4634fbd1560422090b02694b89b6add1f5a155c3983a07af14c7d5c4a",
    "text": "Jo spot rang ya shape badal raha ho ya doosre spots se alag dikhta ho, uski jaanch zaroori hai. Naya, badalta ya khoon nikalne wala spot ho to doctor se jaanch karayein, bhale hi model yeh group dikhaye. Skin specialist roshni wale magnifier se spot dekh sakte hain. Agar woh kisi aur condition jaisa lage to tissue sample ki jaanch madad kar sakti hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 30.319
  },
  {
    "id": "df-what-hi",
    "scope": "category",
    "category": "df",
    "topic": "what",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/df/what-hi.mp3",
    "audioSha256": "edcd1ef9557b7214d5b361de0fa505222f7bd0d33542cbe34a89199e5f9db0d9",
    "textSha256": "8e3930e2b874cbb38f881f7ed78c4df42942c7501e188ae34e28d8f3672c290a",
    "text": "डर्मेटोफाइब्रोमा त्वचा के रेशेदार ऊतक की छोटी, कैंसर रहित गाँठ होती है। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 17.307
  },
  {
    "id": "df-why-hi",
    "scope": "category",
    "category": "df",
    "topic": "why",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/df/why-hi.mp3",
    "audioSha256": "88130f80feedf60056a3829318d6134ca3031cae6d519436154edeaf15e52a36",
    "textSha256": "b6a5e39f3ad40a0ebabea80c94a2d0d9dad8af4a52b53d785e8b94fba6ed753f",
    "text": "कारण अक्सर स्पष्ट नहीं होता। कुछ लोगों को वहाँ हल्की चोट या कीड़े का काटना याद होता है, लेकिन कई लोगों को ऐसा कुछ याद नहीं होता। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 17.726
  },
  {
    "id": "df-how-hi",
    "scope": "category",
    "category": "df",
    "topic": "how",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/df/how-hi.mp3",
    "audioSha256": "668cf9fea478e84bf686c1cdd96512228c201c5b183401943f49898857127873",
    "textSha256": "f3dbdde28e61657b40eaddeb9e31333888f73a3659d5717dc7b82b6aaa2ddb9a",
    "text": "यह अक्सर बाँह या पैर पर एक सख्त उभार के रूप में बनता है और सालों तक रह सकता है। उभार गुलाबी या भूरा दिख सकता है। गहरे रंग की त्वचा पर यह और गहरा दिख सकता है। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 21.653
  },
  {
    "id": "df-next-hi",
    "scope": "category",
    "category": "df",
    "topic": "next",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/df/next-hi.mp3",
    "audioSha256": "90e4df024749e7fa5ac73a8574dd725bd5afb95288ec075b4820ddcae66740b7",
    "textSha256": "a9c5271ec3b5d16bb3e12b3a9ac0635230086a37710b1f4f180f35772b228e68",
    "text": "हाल में गाँठ का बढ़ना या उसके ऊपर की त्वचा पर घाव बनना जाँच कराने की वजह है। नए या बदलते उभार की जाँच कराएँ, खासकर अगर वह बढ़ रहा हो या उस पर घाव बन रहा हो। डॉक्टर देखकर या त्वचा को बड़ा दिखाने वाले यंत्र से इसकी बनावट पहचान सकते हैं। असामान्य बदलाव पर बायोप्सी की ज़रूरत हो सकती है, जिसमें जाँच के लिए नमूना लिया जाता है। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 33.514
  },
  {
    "id": "df-what-hi-Latn",
    "scope": "category",
    "category": "df",
    "topic": "what",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/df/what-hi-Latn.mp3",
    "audioSha256": "48ac848d6df8bab137d994685c37fbfc3054acf23cf0b3e732f30ab8eacaa84f",
    "textSha256": "6436e86fe71c099fd19fdad9feaf932543d4545f47f43c69cbd735dd7cc49c51",
    "text": "Dermatofibroma skin ke reshedaar tissue ki chhoti, noncancerous gaanth hoti hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 17.15
  },
  {
    "id": "df-why-hi-Latn",
    "scope": "category",
    "category": "df",
    "topic": "why",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/df/why-hi-Latn.mp3",
    "audioSha256": "b24e593d7ac8206e3942efa97e4d9186050e951de104d4f625d7fa7bde537ea4",
    "textSha256": "e1cfa25cc3c8e4f48757e69e9cbf4a57a1332247858ed4f8cd6e76f1ff792827",
    "text": "Kaaran aksar saaf nahi hota. Kuch logon ko wahan chhoti chot ya keede ka kaatna yaad hota hai, lekin kai logon ko aisa kuch yaad nahi hota. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 15.631
  },
  {
    "id": "df-how-hi-Latn",
    "scope": "category",
    "category": "df",
    "topic": "how",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/df/how-hi-Latn.mp3",
    "audioSha256": "9c34361028ddad9b9ad39e42eccb1d1b867d29b157d20869cab8ca89154abdc6",
    "textSha256": "6da050a3727710925b28e93d30d3b99578abbd4e00f4e15cf3bfe666df403694",
    "text": "Yeh aksar baanh ya pair par ek sakht ubhaar banta hai aur saalon tak reh sakta hai. Ubhaar gulaabi ya bhoora dikh sakta hai. Gehri skin tone par iska rang aur gehra dikh sakta hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 21.417
  },
  {
    "id": "df-next-hi-Latn",
    "scope": "category",
    "category": "df",
    "topic": "next",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/df/next-hi-Latn.mp3",
    "audioSha256": "99c3792498c0e1a518bcf94829b8800c76f5add596c61b6b7c0dbd25786abb1b",
    "textSha256": "368cba5caec4fee0a62f7794f84dc466053d364ce90b4d23ee64471961b9619c",
    "text": "Haal mein gaanth badhna ya uske upar ki skin par ghaav banna jaanch karane ki wajah hai. Naye ya badalte ubhaar ki jaanch karayein, khaaskar agar woh badh raha ho ya us par ghaav ban raha ho. Doctor dekhkar ya skin magnifier se iska pattern pehchaan sakte hain. Ajeeb badlav par biopsy ki zaroorat ho sakti hai, jismein jaanch ke liye sample liya jaata hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 30.398
  },
  {
    "id": "mel-what-hi",
    "scope": "category",
    "category": "mel",
    "topic": "what",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/mel/what-hi.mp3",
    "audioSha256": "475f9d417e8a8b04ecc7f7a8dedad02574bde8f54385962bc10fba2a5fad1b0d",
    "textSha256": "02e5a32859614bfd5d2211ddc41a9890b5ee482e029204d9fda1057313b99a79",
    "text": "मेलानोमा ऐसा कैंसर है जो त्वचा को रंग देने वाली कोशिकाओं में शुरू होता है। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 17.464
  },
  {
    "id": "mel-why-hi",
    "scope": "category",
    "category": "mel",
    "topic": "why",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/mel/why-hi.mp3",
    "audioSha256": "fb8c6f6cf2407acabf7c34362f13be41f5f4de4470f56043eb4f1eabfaafcd61",
    "textSha256": "6986c6cf72f1547c251ccda6718b99fc993fa5d7ca89f39856c99dbdf0b1fb38",
    "text": "पराबैंगनी किरणों का असर और परिवार में मेलानोमा का इतिहास जोखिम बढ़ा सकते हैं। इनसे हर मामले का कारण नहीं समझाया जा सकता। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 20.422
  },
  {
    "id": "mel-how-hi",
    "scope": "category",
    "category": "mel",
    "topic": "how",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/mel/how-hi.mp3",
    "audioSha256": "256ef7ddf6ec65b7726626cf726d950bdce2cd429a7e7620905f4b94678d342c",
    "textSha256": "ccc9b36477ce26cbb7bbf7b294cd36a44ce473ad2fe5dc766ced02441686d711",
    "text": "यह नए धब्बे के रूप में शुरू हो सकता है या पहले से मौजूद तिल में बन सकता है। यह त्वचा के भीतर गहराई तक बढ़ सकता है। धब्बे के किनारे असमान हो सकते हैं या उसमें कई रंग दिख सकते हैं। कुछ मेलानोमा गुलाबी होते हैं या उनमें रंग बहुत कम दिखता है। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 26.549
  },
  {
    "id": "mel-next-hi",
    "scope": "category",
    "category": "mel",
    "topic": "next",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/mel/next-hi.mp3",
    "audioSha256": "8c4790006bde1bd3b69c5488d12daa6a084a012cc9d27f2108b584d3c78cee2c",
    "textSha256": "0dc9e60886ac57127bd865e07260f69d1a5c25a41969c153f49f313cebb05bd8",
    "text": "आकार, बनावट या रंग में बदलाव पर ध्यान दें। बाकी धब्बों से अलग दिखता धब्बा, खुजली या खून आना भी जाँच की वजह है। नए, बदलते या असामान्य धब्बे के बारे में जल्द डॉक्टर से संपर्क करें। एआई के अगले स्कोर की प्रतीक्षा करने से जाँच में देर हो सकती है। त्वचा विशेषज्ञ अक्सर खास आवर्धक यंत्र से त्वचा की जाँच करते हैं। मेलानोमा का संदेह हो तो पुष्टि के लिए आम तौर पर ऊतक निकालकर सूक्ष्मदर्शी से जाँच की जाती है। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 43.725
  },
  {
    "id": "mel-what-hi-Latn",
    "scope": "category",
    "category": "mel",
    "topic": "what",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/mel/what-hi-Latn.mp3",
    "audioSha256": "f7f06f26cec1238d72c717b49ebc8a0be1e5a98ff2fd6e4f176c1a3d7e7c7fe0",
    "textSha256": "88577a2febc43025aac1f391fb4d4d0554081d7de018b84b1c6662b6a9c466c8",
    "text": "Melanoma ek cancer hai jo skin ko rang dene wale cells mein shuru hota hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 13.851
  },
  {
    "id": "mel-why-hi-Latn",
    "scope": "category",
    "category": "mel",
    "topic": "why",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/mel/why-hi-Latn.mp3",
    "audioSha256": "cfb95691f2c0f643d45b2fa0652283fb20af4833159ed1f987e198a7b028a2fe",
    "textSha256": "8ec10329ae58e8be2b32a3d15df3780f30fbbb424d09a2fca42d6f787297eaff",
    "text": "UV kirnon ka asar aur family mein melanoma ka itihaas risk badha sakte hain. Inse har case ka kaaran nahi samajh aata. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 18.59
  },
  {
    "id": "mel-how-hi-Latn",
    "scope": "category",
    "category": "mel",
    "topic": "how",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/mel/how-hi-Latn.mp3",
    "audioSha256": "8f3ac303c4065fa66208c4f3c46af110dc457405e1eb9bdeb1935d8b7b4b62ab",
    "textSha256": "d5ebb8887cfb6c5522c853225fd9f11834e935b015be7032668345b90b1a7605",
    "text": "Yeh naye spot ke roop mein shuru ho sakta hai ya pehle se maujood til mein ban sakta hai. Yeh skin mein gehraai tak badh sakta hai. Spot ke kinaare uneven ho sakte hain ya usmein kai rang dikh sakte hain. Kuch melanoma gulaabi hote hain ya unmein rang bahut kam dikhta hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 25.345
  },
  {
    "id": "mel-next-hi-Latn",
    "scope": "category",
    "category": "mel",
    "topic": "next",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/mel/next-hi-Latn.mp3",
    "audioSha256": "20e97ff89f0043b91013891462a396f8347e8f814fcfc7a5638cff7cf7ea1b4c",
    "textSha256": "31597fa75e9d3d6a0d6b1d881036726c89e3ca3a2a32e30e2f2160634ec43bf2",
    "text": "Size, shape ya rang mein badlav par dhyan dein. Baaki spots se alag dikhta spot, khujli ya khoon aana bhi jaanch ki wajah hai. Naye, badalte ya asaamanya spot ke baare mein jald doctor se sampark karein. Agle AI score ka intezaar karne se jaanch mein der ho sakti hai. Skin specialist aksar khaas magnifier se skin ki jaanch karte hain. Melanoma ka shak ho to pushti ke liye aam taur par tissue nikaal kar microscope se jaanch ki jaati hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 38.122
  },
  {
    "id": "nv-what-hi",
    "scope": "category",
    "category": "nv",
    "topic": "what",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/nv/what-hi.mp3",
    "audioSha256": "57fd92ba045cc3707c4bd923b297737d90464ad31528719cae123114203f6bbc",
    "textSha256": "3cd03b8be63d99479b0f587571ba74b8f06d3bedc527ebaae11e7dfb969e8e1c",
    "text": "तिल में त्वचा को रंग देने वाली कोशिकाएँ एक जगह इकट्ठी होती हैं। इस प्रकार के तिल को डॉक्टर मेलानोसाइटिक नेवस कहते हैं। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 17.935
  },
  {
    "id": "nv-why-hi",
    "scope": "category",
    "category": "nv",
    "topic": "why",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/nv/why-hi.mp3",
    "audioSha256": "57b3c0cb6f54831f5d57fc74943dcecc2a83395b94f91815ca1c27873896ee26",
    "textSha256": "74d0fea9c6d807a5df4da7916c1284e4314a3ad0205d4a1479bace84ae3acce1",
    "text": "आनुवंशिक गुण और धूप का असर इस बात को प्रभावित कर सकते हैं कि कितने तिल बनें। किसी एक तिल के बनने का कारण अक्सर स्पष्ट नहीं होता। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 21.496
  },
  {
    "id": "nv-how-hi",
    "scope": "category",
    "category": "nv",
    "topic": "how",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/nv/how-hi.mp3",
    "audioSha256": "3fc2bb2e77c21fa4343e6f0dc000225708775a3cd5142c4b8189a622999c2543",
    "textSha256": "23bbfdbfec52531f51111432967683cccef40416d257f5e166df3b084d44a697",
    "text": "कुछ तिल जन्म से होते हैं। दूसरे बाद में बनते हैं, अक्सर बचपन में। कुछ समय के साथ हल्के पड़ जाते हैं। तिल सपाट या उभरे हुए हो सकते हैं। उनका रंग त्वचा जैसा, भूरा या उससे गहरा हो सकता है। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 22.7
  },
  {
    "id": "nv-next-hi",
    "scope": "category",
    "category": "nv",
    "topic": "next",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/nv/next-hi.mp3",
    "audioSha256": "7cf0b48e528ef4d43a2a9033a8046115de21fd628a8903c1c4381d0b14b672e7",
    "textSha256": "ba4440eb3ac91b82047c926804b8d4687c38c7c3f7d8f13f2f284ca9066321a9",
    "text": "तिल का आकार या रंग बदलना, उससे खून आना या उसका बाकी तिलों से अलग दिखना जाँच की वजह है। नए या बदलते धब्बे को लेकर चिंता हो तो डॉक्टर से जाँच कराएँ, भले ही मॉडल उसे तिल बताए। डॉक्टर उसकी तुलना दूसरे तिलों से कर सकते हैं और आवर्धक यंत्र से उसकी बनावट देख सकते हैं। संदेह होने पर जाँच के लिए धब्बा निकाला जा सकता है। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 32.152
  },
  {
    "id": "nv-what-hi-Latn",
    "scope": "category",
    "category": "nv",
    "topic": "what",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/nv/what-hi-Latn.mp3",
    "audioSha256": "2fea589b624b72138a426bd5719fe1ff91afeb3295c8b53e32bc07a3fb86640f",
    "textSha256": "813b7653d0a4fcc406a23b0ce9130ba10142e64ee43ab52071b6c70ff19c1ce8",
    "text": "Til mein skin ko rang dene wale cells ek jagah ikatthe hote hain. Is type ke til ko doctor melanocytic nevus kehte hain. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 16.102
  },
  {
    "id": "nv-why-hi-Latn",
    "scope": "category",
    "category": "nv",
    "topic": "why",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/nv/why-hi-Latn.mp3",
    "audioSha256": "ea2b96253a9f415d27f5c1b519b7fe31083c3c8d70e05bad62a3dab55133b831",
    "textSha256": "aab39e1ea6d4dc284238145a95ff9ae9cec1e00740d60fdcb3ff223421fbaca5",
    "text": "Vanshanugat gun aur dhoop ka asar is baat par pad sakta hai ki kitne til banein. Kisi ek til ka kaaran aksar saaf nahi hota. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 18.59
  },
  {
    "id": "nv-how-hi-Latn",
    "scope": "category",
    "category": "nv",
    "topic": "how",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/nv/how-hi-Latn.mp3",
    "audioSha256": "b80e9e2e4c7e2b8ce5efa00fb6b1e14ec9fc494fd1a56291af7d1b6afc453755",
    "textSha256": "52332312fc2b1de40c24864ebdc8a01b8a0f0ad450a46d1e286e6cdbc77333b8",
    "text": "Kuch til janm se hote hain. Doosre baad mein bante hain, aksar bachpan mein. Kuch dheere-dheere halke pad jaate hain. Til flat ya ubhre hue ho sakte hain. Unka rang skin jaisa, bhoora ya usse gehra ho sakta hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 21.731
  },
  {
    "id": "nv-next-hi-Latn",
    "scope": "category",
    "category": "nv",
    "topic": "next",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/nv/next-hi-Latn.mp3",
    "audioSha256": "5feb176db04b32f998a31c2bb507a448116efd19b2d009c9d5d7c70a890023cf",
    "textSha256": "a9d725349212d0da4bd428d64d332742cd7b85d57484fa29d1b4d5f95abfd5a7",
    "text": "Til ka shape ya rang badalna, usse khoon aana ya uska baaki tilon se alag dikhna jaanch ki wajah hai. Naye ya badalte spot ko lekar chinta ho to doctor se jaanch karayein, bhale hi model use til bataye. Doctor uski tulna doosre tilon se kar sakte hain aur magnifier se uska pattern dekh sakte hain. Shak hone par jaanch ke liye spot nikaala ja sakta hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 28.303
  },
  {
    "id": "vasc-what-hi",
    "scope": "category",
    "category": "vasc",
    "topic": "what",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/vasc/what-hi.mp3",
    "audioSha256": "44d95e92ee1bb0624afa5ad0d3743f0f7c03797bba8a29beec9f3b95b5e19568",
    "textSha256": "2a111256529e6e2f73695c4117029f3ad325499ab678daa17ddff1a9aa9ebb79",
    "text": "इस समूह में अलग-अलग निशान आते हैं। इनमें छोटी रक्त वाहिकाओं के बढ़ने से बने उभार और त्वचा में खून रिसने से बने निशान शामिल हैं। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 18.851
  },
  {
    "id": "vasc-why-hi",
    "scope": "category",
    "category": "vasc",
    "topic": "why",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/vasc/why-hi.mp3",
    "audioSha256": "58ff1e7f3b86a122a3c2a1adc897ac43420121c6cab8925be33ecaa380284132",
    "textSha256": "37705dc0dc48d2fc291d462e75c2852a62cff891b69de327e5165d361d54812c",
    "text": "कारण प्रकार के अनुसार बदलते हैं। चेरी एंजियोमा उम्र के साथ अधिक आम होते हैं और उनका कारण स्पष्ट नहीं है। कुछ दूसरे प्रकार के उभार हल्की चोट के बाद बन सकते हैं। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 19.82
  },
  {
    "id": "vasc-how-hi",
    "scope": "category",
    "category": "vasc",
    "topic": "how",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/vasc/how-hi.mp3",
    "audioSha256": "5813c8b924ff35016d10f47e548570f585970ade19fda8563e1e653c35576fa8",
    "textSha256": "81694badc076fb36b10846ae1d615058b3a5d7c470d3e2c838a918a86f9c83df",
    "text": "पायोजेनिक ग्रैन्युलोमा नाम का एक प्रकार कुछ हफ्तों में बढ़ सकता है और हल्की चोट लगने पर उससे खून आ सकता है। दूसरे प्रकार का क्रम अलग हो सकता है। कुछ निशान छोटे लाल या बैंगनी उभार जैसे होते हैं। कुछ नीले या बहुत गहरे रंग के दिख सकते हैं। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 24.533
  },
  {
    "id": "vasc-next-hi",
    "scope": "category",
    "category": "vasc",
    "topic": "next",
    "locale": "hi",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/vasc/next-hi.mp3",
    "audioSha256": "5f2f90a0ed32604b9c7d36983ca8464a60990469bfb9dec47f2a7638cd46b320",
    "textSha256": "48d80d560b93ee2cecd0a6139a29e7cd338386fc6bab8906cd91c581e5df1c4d",
    "text": "तेज़ी से बढ़ना, बार-बार खून आना या गहरे रंग के निशान में बदलाव डॉक्टर की राय लेने की वजह हैं। बिना स्पष्ट कारण बढ़ते या खून निकलने वाले निशान की जाँच कराएँ, भले ही मॉडल रक्त वाहिकाओं से जुड़ा कोई नाम दिखाए। डॉक्टर निशान को देखते हैं और आवर्धक यंत्र का उपयोग कर सकते हैं। पहचान स्पष्ट न हो तो ऊतक की सूक्ष्मदर्शी से जाँच की जा सकती है। तस्वीर का स्कोर यह तय नहीं कर सकता कि धब्बा क्या है, क्यों बना या कितनी जल्दी देखभाल की ज़रूरत है। मॉडल का स्कोर जो भी हो, किसी धब्बे को लेकर चिंता हो तो डॉक्टर से बात करें।",
    "durationSeconds": 33.933
  },
  {
    "id": "vasc-what-hi-Latn",
    "scope": "category",
    "category": "vasc",
    "topic": "what",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/vasc/what-hi-Latn.mp3",
    "audioSha256": "2c91a4ca5664cfc585153a7963d7f143163078f75f8ab90ecfc2bac712bd8960",
    "textSha256": "0992bf8458c7436c40fd680771ca06c489b9423efc8a607e72f547282f2f150b",
    "text": "Is group mein alag-alag marks aate hain. Inmein chhoti blood vessels badhne se bane ubhaar aur skin mein khoon risne se bane nishaan shaamil hain. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 15.971
  },
  {
    "id": "vasc-why-hi-Latn",
    "scope": "category",
    "category": "vasc",
    "topic": "why",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/vasc/why-hi-Latn.mp3",
    "audioSha256": "654580b531032a1c54e78844c3b29d0194d57720751573b837d5c9bbe2dd66a3",
    "textSha256": "fad134927f7799eb7c9dc51a04114632ae29c75dc2e169d6802ca190971444eb",
    "text": "Kaaran type ke hisaab se badalte hain. Cherry angioma umar ke saath zyada aam hote hain aur unka kaaran saaf nahi hai. Kuch doosre vessel growths halki chot ke baad ban sakte hain. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 18.851
  },
  {
    "id": "vasc-how-hi-Latn",
    "scope": "category",
    "category": "vasc",
    "topic": "how",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/vasc/how-hi-Latn.mp3",
    "audioSha256": "964e61f2f495d192188bb39bfceff3dc64a2994b384a6a4a0ec199329646542f",
    "textSha256": "ece4658bc63739a3a246ff65c58367b7d29ca172f148d50ea600e49d601a92f1",
    "text": "Pyogenic granuloma naam ka ek type kuch hafton mein badh sakta hai aur halki chot se usmein se khoon aa sakta hai. Doosre types alag tarah se badal sakte hain. Kuch nishaan chhote laal ya baingani ubhaar jaise hote hain. Kuch neele ya bahut gehre rang ke dikh sakte hain. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 25.188
  },
  {
    "id": "vasc-next-hi-Latn",
    "scope": "category",
    "category": "vasc",
    "topic": "next",
    "locale": "hi-Latn",
    "contentVersion": "skin-health-3a1.1",
    "localeRevision": "1",
    "clinicalReviewStatus": "clinical_review_required",
    "audio": "/internal-review-audio/file/library/vasc/next-hi-Latn.mp3",
    "audioSha256": "a0c40e7f67ee730fdb4357026ff324cf47ee284026ae4949b3e425541a530502",
    "textSha256": "311195130cba15f705ccf45288587e49169ec7f2df930723b2a0bc75ba2098a8",
    "text": "Tezi se badhna, baar-baar khoon aana ya gehre rang ke nishaan mein badlav doctor ki rai lene ki wajah hain. Bina saaf wajah badhte ya khoon nikalne wale nishaan ki jaanch karayein, bhale hi model blood vessels se juda koi naam dikhaye. Doctor nishaan dekhte hain aur magnifier ka istemaal kar sakte hain. Pehchaan saaf na ho to tissue ko microscope se jaancha ja sakta hai. Photo ka score yeh tay nahi kar sakta ki spot kya hai, kyun bana ya kitni jaldi care chahiye. Model ka score jo bhi ho, kisi spot ko lekar chinta ho to doctor se baat karein.",
    "durationSeconds": 31.943
  }
] as const;

export function getInternalAudioAsset(query: {
  scope: 'general' | 'category';
  category?: SkinClass | null;
  topic?: EducationTopic | null;
  locale: EducationLocale;
}): InternalAudioAsset | null {
  if (query.locale !== 'hi' && query.locale !== 'hi-Latn') {
    return null;
  }
  return (
    INTERNAL_SARVAM_AUDIO_ASSETS.find((asset) => {
      if (asset.scope !== query.scope || asset.locale !== query.locale) {
        return false;
      }
      if (query.scope === 'category') {
        return asset.category === query.category && asset.topic === query.topic;
      }
      return true;
    }) ?? null
  );
}

export function getInternalAudioText(query: {
  scope: 'general' | 'category';
  category?: SkinClass | null;
  topic?: EducationTopic | null;
  locale: EducationLocale;
}): string | null {
  const asset = getInternalAudioAsset(query);
  return asset ? asset.text : null;
}

export async function verifyAudioBlobIntegrity(
  data: ArrayBuffer,
  expectedSha256: string,
): Promise<{ valid: boolean; actualSha256: string }> {
  const actualSha256 = await sha256Hex(data);
  return {
    valid: actualSha256.toLowerCase() === expectedSha256.toLowerCase(),
    actualSha256,
  };
}

export async function loadVerifiedInternalAudio(
  asset: InternalAudioAsset,
  expectedText: string,
  signal?: AbortSignal,
): Promise<string> {
  // 1. Cryptographic text binding check
  const textDigest = await sha256TextHex(expectedText);
  if (textDigest.toLowerCase() !== asset.textSha256.toLowerCase()) {
    throw new Error(
      `Audio text binding mismatch: expected ${asset.textSha256}, got ${textDigest}`
    );
  }

  // 2. Fetch audio bytes from dev server
  const response = await fetch(asset.audio, {
    signal,
    mode: 'same-origin',
    redirect: 'error',
    credentials: 'omit',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch internal review audio (${response.status})`);
  }

  // 3. Cryptographic audio payload integrity check
  const bytes = await response.arrayBuffer();
  const { valid, actualSha256 } = await verifyAudioBlobIntegrity(bytes, asset.audioSha256);
  if (!valid) {
    throw new Error(
      `Audio media integrity check failed: expected ${asset.audioSha256}, got ${actualSha256}`
    );
  }

  signal?.throwIfAborted();
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  return URL.createObjectURL(blob);
}
