// ------------------- 1. إعداد قاعدة البيانات المشفرة -------------------
const db = new Dexie('MunjezDB');
db.version(1).stores({
    documents: '++id, title, type, expiryDate, encryptedData, iv, createdAt',
    reminders: '++id, title, remindDate, documentId, status'
});

// ------------------- 2. نظام التشفير (AES-GCM) -------------------
let isUnlocked = false;

// دالة لتوليد مفتاح التشفير من كلمة المرور
async function getEncryptionKey(password) {
    const encoder = new TextEncoder();
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    
    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

// دالة لتشفير البيانات
async function encryptData(data, password) {
    const key = await getEncryptionKey(password);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encoder.encode(data)
    );
    
    return {
        encryptedData: Array.from(new Uint8Array(encrypted)),
        iv: Array.from(iv)
    };
}

// دالة لفك التشفير
async function decryptData(encryptedArray, ivArray, password) {
    const key = await getEncryptionKey(password);
    const encrypted = new Uint8Array(encryptedArray);
    const iv = new Uint8Array(ivArray);
    
    try {
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            encrypted
        );
        return new TextDecoder().decode(decrypted);
    } catch (e) {
        console.error('فك التشفير فشل: كلمة المرور غير صحيحة');
        return null;
    }
}

// ------------------- 3. إدارة المستندات -------------------
async function addDocument(imageData, title, password) {
    const encrypted = await encryptData(imageData, password);
    const doc = {
        title: title,
        type: 'مستند',
        expiryDate: null,
        encryptedData: encrypted.encryptedData,
        iv: encrypted.iv,
        createdAt: new Date().toISOString()
    };
    return db.documents.add(doc);
}

async function getDocuments(password) {
    const docs = await db.documents.toArray();
    const decryptedDocs = [];
    for (const doc of docs) {
        const decryptedData = await decryptData(doc.encryptedData, doc.iv, password);
        if (decryptedData) {
            decryptedDocs.push({ ...doc, decryptedData });
        }
    }
    return decryptedDocs;
}

// ------------------- 4. استخراج البيانات باستخدام Tesseract.js -------------------
async function extractTextFromImage(imageFile) {
    const worker = await Tesseract.createWorker('ara');
    const { data: { text } } = await worker.recognize(imageFile);
    await worker.terminate();
    return text;
}

function extractExpiryDate(text) {
    // البحث عن تاريخ بصيغة dd/mm/yyyy
    const regex = /(\d{2}[\/\-]\d{2}[\/\-]\d{4})/;
    const match = text.match(regex);
    return match ? match[0] : null;
}

// ------------------- 5. إدارة التذكيرات والإشعارات -------------------
async function addReminder(title, remindDate, documentId = null) {
    const reminder = {
        title: title,
        remindDate: remindDate,
        documentId: documentId,
        status: 'pending'
    };
    await db.reminders.add(reminder);
    scheduleNotification(reminder);
}

function scheduleNotification(reminder) {
    const remindTime = new Date(reminder.remindDate).getTime();
    const now = new Date().getTime();
    const delay = remindTime - now;
    
    if (delay > 0) {
        setTimeout(() => {
            showNotification(reminder.title, 'حان موعد التذكير');
        }, delay);
    }
}

function showNotification(title, body) {
    if (Notification.permission === 'granted') {
        new Notification(title, { body: body });
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                new Notification(title, { body: body });
            }
        });
    }
}

// ------------------- 6. معالج الصور -------------------
async function captureAndProcess() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            // عرض شاشة تحميل
            const loadingDiv = document.createElement('div');
            loadingDiv.innerText = 'جاري معالجة المستند...';
            document.body.appendChild(loadingDiv);
            
            try {
                // استخراج النص
                const extractedText = await extractTextFromImage(file);
                const expiryDate = extractExpiryDate(extractedText);
                
                // قراءة الملف كـ Base64 للتخزين
                const reader = new FileReader();
                reader.onload = async (event) => {
                    const password = localStorage.getItem('masterPassword');
                    if (password) {
                        const docId = await addDocument(event.target.result, 'مستند جديد', password);
                        
                        if (expiryDate) {
                            await addReminder('انتهاء المستند', expiryDate, docId);
                        }
                        
                        alert('تم حفظ المستند بنجاح');
                        loadDocuments(); // تحديث الواجهة
                    } else {
                        alert('يجب إدخال كلمة المرور أولاً');
                    }
                    loadingDiv.remove();
                };
                reader.readAsDataURL(file);
            } catch (error) {
                console.error(error);
                alert('حدث خطأ أثناء معالجة المستند');
                loadingDiv.remove();
            }
        }
    };
    input.click();
}

// ------------------- 7. تحميل وعرض المستندات -------------------
async function loadDocuments() {
    const password = localStorage.getItem('masterPassword');
    if (!password) return;
    
    const docs = await getDocuments(password);
    const container = document.getElementById('documentsList');
    container.innerHTML = '';
    
    docs.forEach(doc => {
        const card = document.createElement('div');
        card.className = 'document-card';
        card.innerHTML = `
            <strong>${doc.title}</strong>
            <small>تاريخ الانتهاء: ${doc.expiryDate || 'غير محدد'}</small>
        `;
        card.onclick = () => showDocument(doc.decryptedData);
        container.appendChild(card);
    });
}

function showDocument(dataUrl) {
    const win = window.open();
    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.maxWidth = '100%';
    win.document.body.appendChild(img);
}

// ------------------- 8. تهيئة التطبيق -------------------
document.addEventListener('DOMContentLoaded', () => {
    // إدارة التبويبات
    const tabs = document.querySelectorAll('.nav-btn');
    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            tabs.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
    
    // زر إضافة مستند
    document.getElementById('addDocumentBtn').addEventListener('click', captureAndProcess);
    
    // فتح الخزنة بكلمة المرور
    document.getElementById('unlockBtn').addEventListener('click', async () => {
        const password = document.getElementById('masterPassword').value;
        if (password) {
            localStorage.setItem('masterPassword', password);
            document.getElementById('passwordModal').style.display = 'none';
            await loadDocuments();
        } else {
            alert('يرجى إدخال كلمة المرور');
        }
    });
    
    // طلب إذن الإشعارات
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
    
    // عرض نافذة كلمة المرور إذا لم تكن موجودة
    if (!localStorage.getItem('masterPassword')) {
        document.getElementById('passwordModal').style.display = 'flex';
    } else {
        document.getElementById('passwordModal').style.display = 'none';
        loadDocuments();
    }
});
