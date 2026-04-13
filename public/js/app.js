import {
  auth, db, onAuthStateChanged, signOut,
  collection, doc, addDoc, getDoc, getDocs, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, updateDoc, deleteDoc
} from './firebase-init.js?v=4';

// Firebase Functions URL (Gemini API - 한국 리전)
const WORKER_BASE_URL = 'https://chat-yj33ol7uua-du.a.run.app';

dayjs.locale('ko');

window.tutorApp = function() {
  return {
    // State
    user: null,
    userInitials: '',
    userRole: '',
    photoURL: null,
    sidebarOpen: false,
    sidebarTab: 'chats',
    currentMessage: '',
    messages: [],
    isTyping: false,
    isLoading: false,
    currentSessionId: null,
    chatHistory: [],
    myTickets: [],
    
    // Ticket View Modal State (사이드 패널)
    showTicketViewModal: false,
    selectedTicket: null,
    followUpMessage: '',

    // 수강 중인 강사 목록 (강사에게 질문 시 선택)
    enrolledInstructors: [],
    selectedInstructorId: '',
    selectedInstructorName: '',
    
    // Highlight popup state
    showHighlightPopup: false,
    selectedMessageIndex: null,
    selectedText: '',
    selectedMessageContent: '',
    popupPosition: { top: '0px', left: '50%' },
    
    // Ticket modal
    showTicketModal: false,
    ticketQuestion: '',
    
    // Chat menu
    showChatMenu: false,
    selectedChatId: null,
    chatMenuPosition: { top: '0px', left: '0px' },
    currentChatUnsubscribe: null,
    
    // Notifications
    notifications: [],
    unreadCount: 0,
    showNotifications: false,
    
    // Settings
    theme: 'light',
    language: 'ko',
    notificationsEnabled: true,
    showSettingsDropdown: false,
    
    // Profile
    showProfileModal: false,
    editingProfile: false,
    profileForm: { displayName: '', photoURL: '' },
    showProfileDropdown: false,
    
    // Chat Settings Modal
    showChatSettingsModal: false,
    
    // File attachment
    attachedFile: null,
    attachedFilePreview: null,
    attachedFileName: '',
    attachedFileMimeType: '',
    
    // Initialization
    async init() {
      
      // Load saved settings immediately
      this.loadSettings();
      
      try {
        // Wait for Firebase auth
        onAuthStateChanged(auth, async (user) => {
          
          if (user) {
            this.user = {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName || user.email.split('@')[0],
              photoURL: user.photoURL
            };
            this.userInitials = this.getInitials(this.user.displayName);

            // Load profile photo from userProfiles
            try {
              const profileDoc = await getDoc(doc(db, 'userProfiles', user.uid));
              if (profileDoc.exists()) {
                this.photoURL = profileDoc.data().photoURL || null;
                this.user.photoURL = this.photoURL;
              }
            } catch (e) {
              console.error('Profile photo load error:', e);
            }

            // Load role from Firestore
            let isInstructor = false;
            try {
              const userDoc = await getDoc(doc(db, 'users', user.uid));
              if (userDoc.exists()) {
                const role = userDoc.data().role;
                if (['instructor', 'admin', 'staff'].includes(role)) {
                  this.userRole = '강사';
                  isInstructor = true;
                } else if (role === 'student') {
                  this.userRole = '수강생';
                } else {
                  this.userRole = role || '수강생';
                }
              } else {
                this.userRole = '수강생';
              }
            } catch (e) {
              console.error('Role load error:', e);
              this.userRole = '수강생';
            }

            // 강사/admin/staff는 chat.html 접근 불가 (학생 전용)
            if (isInstructor) {
              await Swal.fire({
                icon: 'info',
                title: '학생 전용 기능입니다',
                text: '대시보드로 이동합니다.',
                confirmButtonColor: '#2563eb',
                timer: 2000,
                showConfirmButton: false
              });
              window.location.href = 'instructor.html';
              return;
            }

            // Load chat history, tickets, enrolled instructors
            await this.loadChatHistory();
            await this.loadMyTickets();
            await this.loadEnrolledInstructors();

            // Subscribe to notifications
            this.subscribeToNotifications();
            
            // Check URL parameters for chat ID from dashboard
            const urlParams = new URLSearchParams(window.location.search);
            const chatId = urlParams.get('chat');
            const newChat = urlParams.get('new');
            
            if (chatId) {
              // Load specific chat from dashboard
              this.loadChat(chatId);
              // Clear the URL parameter without reloading
              window.history.replaceState({}, document.title, 'chat.html');
            } else if (newChat) {
              // Start new chat
              this.startNewChat();
              window.history.replaceState({}, document.title, 'chat.html');
            } else if (this.chatHistory.length > 0) {
              // Load most recent chat
              this.loadChat(this.chatHistory[0].id);
            } else {
              // No chats yet, show welcome screen
              this.messages = [];
              this.currentSessionId = null;
            }
          } else {
            // Redirect to login if not authenticated
            window.location.href = 'login.html';
          }
        });
      } catch (error) {
        console.error('Init error:', error);
      }
      
      // Setup keyboard shortcuts
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.closeHighlightPopup();
          this.sidebarOpen = false;
          this.showTicketModal = false;
        }
      });
    },
    
    // Helpers
    getInitials(name) {
      if (!name) return '?';
      return name.charAt(0).toUpperCase();
    },
    
    renderMarkdown(content) {
      if (!content) return '';
      const rawHtml = marked.parse(content);
      return DOMPurify.sanitize(rawHtml);
    },
    
    formatDate(timestamp) {
      if (!timestamp) return '';
      return dayjs(timestamp.toDate ? timestamp.toDate() : timestamp).format('MM월 DD일');
    },
    
    formatTime(timestamp) {
      if (!timestamp) return '';
      return dayjs(timestamp.toDate ? timestamp.toDate() : timestamp).format('HH:mm');
    },
    
    autoResize() {
      const textarea = this.$refs.messageInput;
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    },
    
    // Chat functions
    async loadChatHistory() {
      if (!this.user) return;
      
      const q = query(
        collection(db, 'chat_sessions'),
        where('user_id', '==', this.user.uid),
        orderBy('updated_at', 'desc'),
        limit(20)
      );
      
      onSnapshot(q, (snapshot) => {
        this.chatHistory = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
      });
    },
    
    async loadMyTickets() {
      if (!this.user) return;

      const q = query(
        collection(db, 'tickets'),
        where('student_uid', '==', this.user.uid),
        orderBy('created_at', 'desc'),
        limit(20)
      );

      onSnapshot(q, (snapshot) => {
        this.myTickets = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      });
    },

    async loadEnrolledInstructors() {
      if (!this.user) return;

      try {
        const enrollQ = query(
          collection(db, 'courseEnrollments'),
          where('studentId', '==', this.user.uid),
          where('status', '==', 'approved')
        );
        const enrollSnap = await getDocs(enrollQ);
        const courseIds = [...new Set(enrollSnap.docs.map(d => d.data().courseId).filter(Boolean))];

        const courseSnaps = await Promise.all(
          courseIds.map(id => getDoc(doc(db, 'courseRequests', id)))
        );

        const seen = new Set();
        this.enrolledInstructors = [];
        courseSnaps.forEach(snap => {
          if (!snap.exists()) return;
          const data = snap.data();
          if (data.instructorId && !seen.has(data.instructorId)) {
            seen.add(data.instructorId);
            this.enrolledInstructors.push({
              id: data.instructorId,
              name: data.instructorName || '강사'
            });
          }
        });
      } catch (e) {
        console.error('Enrolled instructors load error:', e);
      }
    },
    
    async startNewChat() {
      this.currentSessionId = null;
      this.messages = [];
      this.currentMessage = '';
      this.sidebarOpen = false;
      
      // Create new session in Firestore
      const sessionRef = await addDoc(collection(db, 'chat_sessions'), {
        user_id: this.user.uid,
        title: '새 대화',
        messages: [],
        created_at: serverTimestamp(),
        updated_at: serverTimestamp()
      });
      
      this.currentSessionId = sessionRef.id;
    },
    
    async loadChat(sessionId) {
      // Unsubscribe from previous chat listener if exists
      if (this.currentChatUnsubscribe) {
        this.currentChatUnsubscribe();
      }
      
      this.currentSessionId = sessionId;
      this.sidebarOpen = false;
      
      // Use onSnapshot for real-time updates
      const sessionRef = doc(db, 'chat_sessions', sessionId);
      this.currentChatUnsubscribe = onSnapshot(sessionRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          // Force Alpine.js reactivity with new array
          this.messages = [...(data.messages || [])];
          this.$nextTick(() => {
            this.scrollToBottom();
          });
        }
      });
    },
    
    async sendMessage() {
      const message = this.currentMessage.trim();
      if (!message && !this.attachedFile) return;
      if (this.isTyping) return;
      
      // Add user message
      const userMessage = {
        id: 'msg_' + Date.now(),
        role: 'user',
        content: message || (this.attachedFileName ? `[파일: ${this.attachedFileName}]` : ''),
        timestamp: new Date()
      };
      
      // 첨부 파일 정보를 메시지에 포함
      let fileAttachment = null;
      if (this.attachedFile) {
        fileAttachment = {
          data: this.attachedFile,
          mimeType: this.attachedFileMimeType,
          name: this.attachedFileName
        };
        userMessage.attachment = { name: this.attachedFileName, mimeType: this.attachedFileMimeType };
        if (this.attachedFilePreview) {
          userMessage.attachmentPreview = this.attachedFilePreview;
        }
      }
      
      this.messages.push(userMessage);
      this.currentMessage = '';
      this.removeAttachedFile();
      this.autoResize();
      this.scrollToBottom();
      
      // Update session in Firestore (첨부 파일 base64는 저장하지 않음)
      if (this.currentSessionId) {
        const messagesForStore = this.messages.map(m => {
          const { attachmentPreview, ...rest } = m;
          return rest;
        });
        await updateDoc(doc(db, 'chat_sessions', this.currentSessionId), {
          messages: messagesForStore,
          updated_at: serverTimestamp()
        });
      }
      
      // Send to AI (파일 첨부 포함)
      await this.sendToAI(null, fileAttachment);
    },
    
    sendQuickMessage(message) {
      this.currentMessage = message;
      this.sendMessage();
    },
    
    async sendToAI(contextData = null, fileAttachment = null) {
      this.isTyping = true;
      
      try {
        const idToken = await auth.currentUser.getIdToken();
        
        const lastMsg = this.messages.filter(m => m.role === 'user').pop();
        const requestBody = {
          session_id: this.currentSessionId,
          message: lastMsg ? lastMsg.content : '',
          context: contextData || {}
        };
        
        // 파일 첨부가 있으면 요청에 포함
        if (fileAttachment) {
          requestBody.attachment = {
            data: fileAttachment.data,
            mimeType: fileAttachment.mimeType,
            name: fileAttachment.name
          };
        }
        
        const response = await fetch(`${WORKER_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('Worker error response:', errorText);
          throw new Error(`AI request failed: ${response.status} - ${errorText}`);
        }
        
        // Handle streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let aiMessage = {
          id: 'msg_' + Date.now(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true
        };
        
        this.messages.push(aiMessage);
        
        let buffer = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Flush any remaining bytes in decoder
            const finalChunk = decoder.decode(new Uint8Array(), { stream: false });
            if (finalChunk) {
              buffer += finalChunk;
            }
            // Process any remaining data in buffer
            if (buffer.trim()) {
              try {
                const data = JSON.parse(buffer.trim());
                this.processGeminiChunk(data, aiMessage);
              } catch (e) {
                console.error('Final buffer parse error:', e.message);
              }
            }
            break;
          }
          
          const chunk = decoder.decode(value, { stream: true });
          
          buffer += chunk;
          
          // Try to extract complete JSON objects from buffer
          let braceCount = 0;
          let startIndex = 0;
          let inString = false;
          let escapeNext = false;
          
          for (let i = 0; i < buffer.length; i++) {
            const char = buffer[i];
            
            if (escapeNext) {
              escapeNext = false;
              continue;
            }
            
            if (char === '\\') {
              escapeNext = true;
              continue;
            }
            
            if (char === '"' && !inString) {
              inString = true;
            } else if (char === '"' && inString) {
              inString = false;
            }
            
            if (!inString) {
              if (char === '{') {
                if (braceCount === 0) {
                  startIndex = i;
                }
                braceCount++;
              } else if (char === '}') {
                braceCount--;
                if (braceCount === 0) {
                  const jsonStr = buffer.slice(startIndex, i + 1);
                  try {
                    const data = JSON.parse(jsonStr);
                    this.processGeminiChunk(data, aiMessage);
                  } catch (e) {
                    console.error('Parse error for JSON:', jsonStr.substring(0, 50), e.message);
                  }
                  buffer = buffer.slice(i + 1);
                  i = -1; // Reset to process remainder
                }
              }
            }
          }
        }
        
        // Mark streaming as complete
        aiMessage.isStreaming = false;
        this.messages = [...this.messages];
        
        // Save AI response to Firestore
        if (this.currentSessionId) {
          await updateDoc(doc(db, 'chat_sessions', this.currentSessionId), {
            messages: this.messages,
            updated_at: serverTimestamp()
          });
        }
        
        // Generate chat title if this is the first exchange
        if (this.messages.length === 2 && this.currentSessionId) {
          await this.generateChatTitle();
        }
        
      } catch (error) {
        console.error('AI Error:', error);
        this.messages.push({
          id: 'msg_' + Date.now(),
          role: 'assistant',
          content: '죄송합니다. 일시적인 오류가 발생했습니다. 다시 시도해주세요.',
          timestamp: new Date()
        });
      } finally {
        this.isTyping = false;
      }
    },
    
    // Process Gemini streaming chunk
    processGeminiChunk(data, aiMessage) {
      
      // Extract text from Gemini response format
      if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
        const text = data.candidates[0].content.parts[0].text;
        if (text) {
          // Find message in array and update it for Alpine reactivity
          const index = this.messages.findIndex(m => m.id === aiMessage.id);
          if (index !== -1) {
            // Create new message object to trigger Alpine reactivity
            this.messages[index] = {
              ...this.messages[index],
              content: this.messages[index].content + text
            };
            // Force array update
            this.messages = [...this.messages];
            this.$nextTick(() => {
              this.scrollToBottom();
            });
          }
        }
      }
      
      // Check for finish reason
      if (data.candidates && data.candidates[0] && data.candidates[0].finishReason) {
        const index = this.messages.findIndex(m => m.id === aiMessage.id);
        if (index !== -1) {
          this.messages[index].isStreaming = false;
        }
      }
    },
    
    // Auto-generate chat title based on first message
    async generateChatTitle() {
      if (!this.currentSessionId || this.messages.length < 2) return;
      
      const firstUserMessage = this.messages.find(m => m.role === 'user');
      if (!firstUserMessage) return;
      
      try {
        const idToken = await auth.currentUser.getIdToken();
        
        const response = await fetch(`${WORKER_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            session_id: null,
            message: `다음 대화 내용을 바탕으로 간단한 제목을 만들어주세요 (최대 20자). 대화 내용: "${firstUserMessage.content.substring(0, 100)}"`,
            context: { is_title_generation: true }
          })
        });
        
        if (!response.ok) return;
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let title = '';
        let buffer = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          
          // Simple JSON extraction
          let braceCount = 0;
          let startIndex = 0;
          
          for (let i = 0; i < buffer.length; i++) {
            if (buffer[i] === '{') {
              if (braceCount === 0) startIndex = i;
              braceCount++;
            } else if (buffer[i] === '}') {
              braceCount--;
              if (braceCount === 0) {
                try {
                  const data = JSON.parse(buffer.slice(startIndex, i + 1));
                  if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
                    title += data.candidates[0].content.parts[0].text;
                  }
                } catch (e) {}
                buffer = buffer.slice(i + 1);
                i = -1;
              }
            }
          }
        }
        
        // Clean up title: 따옴표, 마침표, 불필요 공백 제거
        title = title.replace(/["'「」『』【】\[\]]/g, '').replace(/\s+/g, ' ').trim();
        if (title.length > 20) {
          title = title.substring(0, 20) + '...';
        }
        
        if (title) {
          // Update session title in Firestore
          await updateDoc(doc(db, 'chat_sessions', this.currentSessionId), {
            title: title,
            updated_at: serverTimestamp()
          });
        }
      } catch (error) {
        console.error('Title generation error:', error);
      }
    },
    
    // Highlight menu functions
    handleTextSelection(event, message, index) {
      // Only allow selection on assistant messages
      if (message.role !== 'assistant') return;

      const selection = window.getSelection();
      const selectedText = selection.toString().trim();

      if (selectedText.length >= 2) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        this.selectedText = selectedText;
        this.selectedMessageContent = message.content;
        this.selectedMessageIndex = index;
        
        // Calculate popup position relative to the message bubble
        const messageBubble = event.target.closest('.message-bubble');
        const bubbleRect = messageBubble.getBoundingClientRect();
        
        this.popupPosition = {
          top: (rect.bottom - bubbleRect.top + 8) + 'px',
          left: '50%'
        };
        
        this.showHighlightPopup = true;
      }
    },
    
    closeHighlightPopup() {
      this.showHighlightPopup = false;
      this.selectedText = '';
      this.selectedMessageIndex = null;
      window.getSelection().removeAllRanges();
    },
    
    async askFollowUp() {
      const contextData = {
        highlighted_text: this.selectedText,
        previous_context: this.messages.slice(-5),
        is_followup: true
      };
      
      // Add follow-up message
      const followUpMessage = {
        id: 'msg_' + Date.now(),
        role: 'user',
        content: `"${this.selectedText}" 이 부분을 더 자세히 설명해줘`,
        timestamp: new Date(),
        highlight_context: contextData
      };
      
      this.messages.push(followUpMessage);
      this.closeHighlightPopup();
      this.scrollToBottom();
      
      // Update session
      if (this.currentSessionId) {
        await updateDoc(doc(db, 'chat_sessions', this.currentSessionId), {
          messages: this.messages,
          updated_at: serverTimestamp()
        });
      }
      
      // Send to AI with context
      await this.sendToAI(contextData);
    },
    
    createTicket() {
      const savedText = this.selectedText;
      this.closeHighlightPopup();
      this.selectedText = savedText;
      this.ticketQuestion = '';
      this.showTicketModal = true;
    },
    
    async submitTicket() {
      if (!this.user || !this.currentSessionId) return;

      this.isLoading = true;

      try {
        // 강사가 읽기 쉬운 포맷으로 맥락 정리
        const recentMessages = this.messages.slice(-6); // 최근 6개 메시지
        const contextLines = recentMessages.map(m => {
          const role = m.role === 'user' ? '🧑 학생' : '🤖 AI 튜터';
          const text = (m.content || '').substring(0, 200) + (m.content?.length > 200 ? '...' : '');
          return `**${role}**: ${text}`;
        }).join('\n\n');

        const formattedContent = [
          '## 📌 강사 질문 티켓\n',
          '---',
          '### 🙋 학생 질문',
          this.ticketQuestion || '(질문 내용 없음)',
          '',
          '### 📝 드래그한 내용 (이해 안 된 부분)',
          this.selectedText ? `> ${this.selectedText}` : '(선택된 텍스트 없음)',
          '',
          '### 💬 관련 대화 맥락 (최근 대화)',
          contextLines || '(대화 내역 없음)',
        ].join('\n');

        // Save ticket directly to Firestore
        const ticketData = {
          chat_session_id: this.currentSessionId,
          student_uid: this.user.uid,
          student_name: this.user.displayName || '학생',
          student_email: this.user.email,
          highlighted_text: this.selectedText || '',
          student_question: this.ticketQuestion || '',
          formatted_content: formattedContent,
          status: 'pending',
          created_at: serverTimestamp(),
          updated_at: serverTimestamp()
        };

        await addDoc(collection(db, 'tickets'), ticketData);
        
        Swal.fire({
          icon: 'success',
          title: '티켓이 발행되었습니다',
          text: '강사님이 확인 후 답변해드릴 예정입니다.',
          confirmButtonText: '확인',
          confirmButtonColor: '#2563eb'
        });
        
        this.showTicketModal = false;
        this.ticketQuestion = '';
        this.selectedText = '';
        
      } catch (error) {
        console.error('Ticket Error:', error);
        Swal.fire({
          icon: 'error',
          title: '티켓 발행 실패',
          text: '잠시 후 다시 시도해주세요.',
          confirmButtonColor: '#2563eb'
        });
      } finally {
        this.isLoading = false;
      }
    },
    
    async suggestCorrection() {
      if (!this.user || !this.currentSessionId) return;
      
      try {
        const idToken = await auth.currentUser.getIdToken();
        
        await fetch(`${WORKER_BASE_URL}/api/feedback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            chat_session_id: this.currentSessionId,
            selected_text: this.selectedText,
            suggestion_type: 'error_correction'
          })
        });
        
        Swal.fire({
          icon: 'success',
          title: '제안이 접수되었습니다',
          text: '검토 후 반영하겠습니다.',
          timer: 2000,
          showConfirmButton: false
        });
        
        this.closeHighlightPopup();
        
      } catch (error) {
        console.error('Feedback Error:', error);
      }
    },
    
    // View ticket detail
    viewTicket(ticketId) {
      const ticket = this.myTickets.find(t => t.id === ticketId);
      if (!ticket) return;
      
      this.selectedTicket = ticket;
      this.followUpMessage = '';
      this.showTicketViewModal = true;
      
      // Mark notification as read if exists
      const notification = this.notifications.find(n => n.ticket_id === ticketId);
      if (notification) {
        updateDoc(doc(db, 'notifications', notification.id), {
          read: true,
          updated_at: serverTimestamp()
        });
      }
      
      // Unsubscribe from previous ticket subscription if exists
      if (this.selectedTicketUnsubscribe) {
        this.selectedTicketUnsubscribe();
        this.selectedTicketUnsubscribe = null;
      }
      
      // Subscribe to real-time updates for this ticket
      this.selectedTicketUnsubscribe = onSnapshot(doc(db, 'tickets', ticketId), (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          // Update follow-up messages and instructor response in real-time
          if (data.follow_up_messages) {
            this.selectedTicket.follow_up_messages = data.follow_up_messages;
          }
          if (data.instructor_response) {
            this.selectedTicket.instructor_response = data.instructor_response;
          }
        }
      });
    },
    
    // Submit follow-up message
    async submitFollowUp() {
      if (!this.followUpMessage.trim() || !this.selectedTicket) return;
      
      const message = {
        role: 'student',
        content: this.followUpMessage.trim(),
        timestamp: new Date()
      };
      
      // Add to local state
      if (!this.selectedTicket.follow_up_messages) {
        this.selectedTicket.follow_up_messages = [];
      }
      this.selectedTicket.follow_up_messages.push(message);
      
      try {
        // Save to Firestore
        await updateDoc(doc(db, 'tickets', this.selectedTicket.id), {
          follow_up_messages: this.selectedTicket.follow_up_messages,
          has_follow_up: true,
          updated_at: serverTimestamp()
        });
        
        // Create notification for instructor with the actual follow-up message content
        const messageContent = this.followUpMessage.trim();
        await addDoc(collection(db, 'notifications'), {
          user_id: this.selectedTicket.instructor_id,
          type: 'ticket_follow_up',
          title: '학생이 추가 질문을 남겼습니다',
          message: `📌 원래 질문: "${this.selectedTicket.student_question || '질문'}"\n\n💬 추가 질문: "${messageContent}"\n\n강사님의 답변을 기다리고 있습니다.`,
          ticket_id: this.selectedTicket.id,
          read: false,
          created_at: serverTimestamp()
        });
        
        this.followUpMessage = '';
        
        Swal.fire({
          icon: 'success',
          title: '추가 질문이 전송되었습니다',
          timer: 1500,
          showConfirmButton: false
        });
      } catch (error) {
        console.error('Follow-up error:', error);
        Swal.fire({
          icon: 'error',
          title: '전송 실패',
          text: '다시 시도해주세요.',
          confirmButtonColor: '#2563eb'
        });
      }
    },
    
    // Chat menu functions
    openChatMenu(chatId, event) {
      this.selectedChatId = chatId;
      this.showChatMenu = true;
      
      // Position menu near the button
      const rect = event.target.closest('button').getBoundingClientRect();
      this.chatMenuPosition = {
        top: (rect.bottom + window.scrollY) + 'px',
        left: (rect.left + window.scrollX - 120) + 'px'
      };
    },
    
    async renameChat() {
      if (!this.selectedChatId) return;
      
      const { value: newTitle } = await Swal.fire({
        title: '대화 제목 변경',
        input: 'text',
        inputLabel: '새 제목',
        inputValue: '',
        showCancelButton: true,
        confirmButtonText: '변경',
        cancelButtonText: '취소',
        confirmButtonColor: '#2563eb',
        inputValidator: (value) => {
          if (!value || value.trim() === '') {
            return '제목을 입력해주세요';
          }
        }
      });
      
      if (newTitle) {
        try {
          await updateDoc(doc(db, 'chat_sessions', this.selectedChatId), {
            title: newTitle.trim(),
            updated_at: serverTimestamp()
          });
          
          Swal.fire({
            icon: 'success',
            title: '제목이 변경되었습니다',
            showConfirmButton: false,
            timer: 1500
          });
        } catch (error) {
          console.error('Rename error:', error);
          Swal.fire({
            icon: 'error',
            title: '오류가 발생했습니다',
            text: '제목 변경에 실패했습니다',
            confirmButtonColor: '#2563eb'
          });
        }
      }
      
      this.showChatMenu = false;
      this.selectedChatId = null;
    },
    
    async deleteChat() {
      if (!this.selectedChatId) return;
      
      const result = await Swal.fire({
        title: '대화 삭제',
        text: '이 대화를 삭제하시겠습니까? 삭제된 대화는 복구할 수 없습니다.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: '삭제',
        cancelButtonText: '취소',
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#6b7280'
      });
      
      if (result.isConfirmed) {
        try {
          await deleteDoc(doc(db, 'chat_sessions', this.selectedChatId));
          
          // If current chat was deleted, clear messages
          if (this.currentSessionId === this.selectedChatId) {
            this.messages = [];
            this.currentSessionId = null;
            // Unsubscribe from deleted chat
            if (this.currentChatUnsubscribe) {
              this.currentChatUnsubscribe();
              this.currentChatUnsubscribe = null;
            }
          }
          
          Swal.fire({
            icon: 'success',
            title: '삭제되었습니다',
            showConfirmButton: false,
            timer: 1500
          });
        } catch (error) {
          console.error('Delete error:', error);
          Swal.fire({
            icon: 'error',
            title: '오류가 발생했습니다',
            text: '대화 삭제에 실패했습니다',
            confirmButtonColor: '#2563eb'
          });
        }
      }
      
      this.showChatMenu = false;
      this.selectedChatId = null;
    },
    
    // UI actions
    showSettings() {
      this.showSettingsDropdown = true;
    },
    
    applyTheme(theme) {
      this.theme = theme;
      localStorage.setItem('tb_theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
      if (theme === 'dark') {
        document.body.style.background = '#1a1a2e';
        document.body.style.color = '#e0e0e0';
      } else if (theme === 'cupcake') {
        document.body.style.background = '#faf7f5';
        document.body.style.color = '#291334';
      } else {
        document.body.style.background = '';
        document.body.style.color = '';
      }
    },
    
    toggleNotifications(enabled) {
      this.notificationsEnabled = enabled;
      localStorage.setItem('tb_notifications', enabled ? 'on' : 'off');
    },
    
    setLanguage(lang) {
      this.language = lang;
      localStorage.setItem('tb_language', lang);
      location.reload();
    },
    
    loadSettings() {
      this.theme = localStorage.getItem('tb_theme') || 'light';
      this.language = localStorage.getItem('tb_language') || 'ko';
      this.notificationsEnabled = localStorage.getItem('tb_notifications') !== 'off';
      this.applyTheme(this.theme);
    },
    
    showProfile() {
      this.profileForm.displayName = this.user?.displayName || '';
      this.editingProfile = false;
      this.showProfileModal = true;
    },
    
    async saveProfile() {
      try {
        const user = auth.currentUser;
        if (user && this.profileForm.displayName) {
          const { updateProfile } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');
          await updateProfile(user, { displayName: this.profileForm.displayName });
          await updateDoc(doc(db, 'users', user.uid), {
            displayName: this.profileForm.displayName,
            updated_at: serverTimestamp()
          });
          this.user.displayName = this.profileForm.displayName;
          this.userInitials = this.profileForm.displayName.charAt(0).toUpperCase();
          this.editingProfile = false;
          Swal.fire({ icon: 'success', title: '프로필 수정 완료', timer: 1500, showConfirmButton: false });
        }
      } catch (e) {
        console.error('Profile update error:', e);
        Swal.fire({ icon: 'error', title: '수정 실패', text: '다시 시도해주세요.', confirmButtonColor: '#2563eb' });
      }
    },
    
    // Chat pin feature
    async togglePinChat(chatId) {
      const chat = this.chatHistory.find(c => c.id === chatId);
      if (!chat) return;
      const newPinned = !chat.pinned;
      await updateDoc(doc(db, 'chat_sessions', chatId), { pinned: newPinned, updated_at: serverTimestamp() });
      this.showChatMenu = false;
    },
    
    get sortedChatHistory() {
      return [...this.chatHistory].sort((a, b) => {
        // 1. 고정된 항목이 먼저
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        // 2. 생성일 기준 내림차순 (최신 생성이 위로, 오래된 것이 아래로)
        const aTime = a.created_at?.seconds || a.createdAt?.getTime?.() / 1000 || 0;
        const bTime = b.created_at?.seconds || b.createdAt?.getTime?.() / 1000 || 0;
        return bTime - aTime;
      });
    },
    
    // Gemini 2.5 호환 파일 타입
    getSupportedFileTypes() {
      return {
        // 이미지
        'image/jpeg': '.jpg,.jpeg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        // 문서
        'application/pdf': '.pdf',
        // 텍스트/코드
        'text/plain': '.txt,.csv,.log',
        'text/html': '.html',
        'text/css': '.css',
        'text/javascript': '.js',
        'application/json': '.json',
        'text/x-python': '.py',
        'text/x-java': '.java',
        'text/markdown': '.md',
      };
    },
    
    attachFile() {
      const supported = this.getSupportedFileTypes();
      const acceptStr = Object.values(supported).join(',') + ',' + Object.keys(supported).join(',');
      
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = acceptStr;
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        // 파일 크기 제한 (10MB)
        if (file.size > 10 * 1024 * 1024) {
          Swal.fire({ icon: 'error', title: '파일 크기 초과', text: '파일 크기는 10MB 이하여야 합니다.', confirmButtonColor: '#2563eb' });
          return;
        }
        
        // MIME 타입 확인
        const supportedMimes = Object.keys(supported);
        let mimeType = file.type;
        // 확장자로 MIME 타입 추론 (브라우저가 제대로 감지 못하는 경우)
        if (!mimeType || !supportedMimes.includes(mimeType)) {
          const ext = file.name.split('.').pop().toLowerCase();
          const extToMime = {
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp',
            'pdf': 'application/pdf', 'txt': 'text/plain', 'csv': 'text/plain', 'log': 'text/plain',
            'html': 'text/html', 'css': 'text/css', 'js': 'text/javascript', 'json': 'application/json',
            'py': 'text/x-python', 'java': 'text/x-java', 'md': 'text/markdown'
          };
          mimeType = extToMime[ext];
          if (!mimeType) {
            Swal.fire({ icon: 'error', title: '지원하지 않는 파일', text: '이미지, PDF, 텍스트/코드 파일만 첨부할 수 있습니다.', confirmButtonColor: '#2563eb' });
            return;
          }
        }
        
        // base64로 변환
        const reader = new FileReader();
        reader.onload = (ev) => {
          const base64Full = ev.target.result; // data:mime;base64,...
          const base64Data = base64Full.split(',')[1]; // base64 데이터만
          
          this.attachedFile = base64Data;
          this.attachedFileMimeType = mimeType;
          this.attachedFileName = file.name;
          
          // 이미지인 경우 미리보기
          if (mimeType.startsWith('image/')) {
            this.attachedFilePreview = base64Full;
          } else {
            this.attachedFilePreview = null;
          }
        };
        reader.readAsDataURL(file);
      };
      input.click();
    },
    
    removeAttachedFile() {
      this.attachedFile = null;
      this.attachedFilePreview = null;
      this.attachedFileName = '';
      this.attachedFileMimeType = '';
    },
    
    async logout() {
      await signOut(auth);
      window.location.href = 'login.html';
    },

    // Alias for chat.html compatibility
    doLogout() {
      return this.logout();
    },
    
    scrollToBottom() {
      this.$nextTick(() => {
        const area = this.$refs.messagesArea;
        if (area) {
          area.scrollTop = area.scrollHeight;
        }
      });
    },
    
    // Auto-resize textarea for input area
    autoResize() {
      this.$nextTick(() => {
        const textarea = this.$refs.messageInput;
        if (textarea) {
          // Reset height to auto to get correct scrollHeight
          textarea.style.height = 'auto';
          // Set new height based on scrollHeight (max 200px)
          const newHeight = Math.min(textarea.scrollHeight, 200);
          textarea.style.height = newHeight + 'px';
        }
      });
    },
    
    handleScroll() {
      // Can be used for pagination or scroll-based UI changes
    },
    
    // Notification methods
    subscribeToNotifications() {
      if (!this.user) return;
      
      const q = query(
        collection(db, 'notifications'),
        where('user_id', '==', this.user.uid),
        where('read', '==', false),
        orderBy('created_at', 'desc'),
        limit(10)
      );
      
      onSnapshot(q, (snapshot) => {
        const newNotifications = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        // Show browser notification for new ones
        newNotifications.forEach(notification => {
          const existing = this.notifications.find(n => n.id === notification.id);
          if (!existing && notification.created_at) {
            this.showBrowserNotification(notification);
          }
        });
        
        this.notifications = newNotifications;
        this.unreadCount = this.notifications.length;
      });
      
      // Request browser notification permission
      this.requestNotificationPermission();
    },
    
    async requestNotificationPermission() {
      if (!('Notification' in window)) return;
      
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
      }
    },
    
    showBrowserNotification(notification) {
      if (!('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;
      
      const notif = new Notification(notification.title || 'TutorBridge', {
        body: notification.message || '새로운 알림이 있습니다',
        icon: '/assets/logo.png',
        badge: '/assets/badge.png',
        requireInteraction: true
      });
      
      notif.onclick = () => {
        window.focus();
        notif.close();
        
        // Mark as read
        if (notification.id) {
          updateDoc(doc(db, 'notifications', notification.id), {
            read: true,
            updated_at: serverTimestamp()
          });
        }
      };
    },

    resolveNotificationUrl(notification) {
      const courseId = notification.courseId || notification.course_id;
      const lessonId = notification.lessonId || notification.lesson_id;
      const postId = notification.postId || notification.post_id;
      const postType = notification.postType || notification.post_type || 'post';
      const ticketId = notification.ticketId || notification.ticket_id;

      if (postId) {
        return `community-post.html?id=${postId}&type=${postType}`;
      }

      if (ticketId) {
        return `my-tickets.html?ticketId=${ticketId}`;
      }

      if (courseId) {
        return lessonId
          ? `classroom.html?courseId=${courseId}&lessonId=${lessonId}`
          : `classroom.html?courseId=${courseId}`;
      }

      if (notification.link) {
        return notification.link;
      }

      return null;
    },
    
    async handleNotification(notification) {
      // Mark as read
      await updateDoc(doc(db, 'notifications', notification.id), {
        read: true,
        updated_at: serverTimestamp()
      });

      // 티켓 관련 알림: 사이드 패널로 열기
      if (notification.ticket_id) {
        const ticket = this.myTickets.find(t => t.id === notification.ticket_id);
        if (ticket) {
          this.viewTicket(ticket.id);
          this.showNotifications = false;
          return;
        }
      }

      const targetUrl = this.resolveNotificationUrl(notification);
      this.showNotifications = false;
      if (targetUrl) {
        window.location.href = targetUrl;
      }
    },

    async deleteNotification(notification) {
      try {
        await updateDoc(doc(db, 'notifications', notification.id), {
          read: true,
          updated_at: serverTimestamp()
        });
      } catch (e) {
        console.warn('Delete notification error:', e);
      }
    },

    async markAllNotificationsRead() {
      const unread = this.notifications.filter(n => !n.read);
      await Promise.all(unread.map(n =>
        updateDoc(doc(db, 'notifications', n.id), { read: true, updated_at: serverTimestamp() })
      ));
    },

    // submitTicket: 강사 선택 포함
    async submitTicketToInstructor() {
      if (!this.user || !this.currentSessionId) return;
      if (!this.selectedInstructorId) {
        Swal.fire({ icon: 'warning', title: '강사를 선택해주세요', confirmButtonColor: '#2563eb' });
        return;
      }

      this.isLoading = true;
      try {
        const recentMessages = this.messages.slice(-6);
        const contextLines = recentMessages.map(m => {
          const role = m.role === 'user' ? '🧑 학생' : '🤖 AI 튜터';
          const text = (m.content || '').substring(0, 200) + (m.content?.length > 200 ? '...' : '');
          return `**${role}**: ${text}`;
        }).join('\n\n');

        const formattedContent = [
          '## 📌 강사 질문 티켓\n',
          '---',
          `### 👨‍🏫 담당 강사: ${this.selectedInstructorName}`,
          '',
          '### 🙋 학생 질문',
          this.ticketQuestion || '(질문 내용 없음)',
          '',
          '### 📝 드래그한 내용 (이해 안 된 부분)',
          this.selectedText ? `> ${this.selectedText}` : '(선택된 텍스트 없음)',
          '',
          '### 💬 관련 대화 맥락 (최근 대화)',
          contextLines || '(대화 내역 없음)',
        ].join('\n');

        const ticketRef = await addDoc(collection(db, 'tickets'), {
          chat_session_id: this.currentSessionId,
          student_uid: this.user.uid,
          student_name: this.user.displayName || '학생',
          student_email: this.user.email,
          highlighted_text: this.selectedText || '',
          student_question: this.ticketQuestion || '',
          formatted_content: formattedContent,
          instructor_id: this.selectedInstructorId,
          instructor_name: this.selectedInstructorName,
          status: 'pending',
          created_at: serverTimestamp(),
          updated_at: serverTimestamp()
        });

        // 강사에게 알림 발송
        await addDoc(collection(db, 'notifications'), {
          user_id: this.selectedInstructorId,
          type: 'new_ticket',
          title: '새 질문이 도착했습니다',
          message: `${this.user.displayName || '학생'}님이 질문을 남겼습니다: "${(this.ticketQuestion || '').substring(0, 40)}"`,
          ticket_id: ticketRef.id,
          read: false,
          created_at: serverTimestamp()
        });

        Swal.fire({
          icon: 'success',
          title: '티켓이 발행되었습니다',
          text: `${this.selectedInstructorName} 강사님이 확인 후 답변해드릴 예정입니다.`,
          confirmButtonText: '확인',
          confirmButtonColor: '#2563eb'
        });

        this.showTicketModal = false;
        this.ticketQuestion = '';
        this.selectedText = '';
        this.selectedInstructorId = '';
        this.selectedInstructorName = '';
      } catch (error) {
        console.error('Ticket Error:', error);
        Swal.fire({ icon: 'error', title: '티켓 발행 실패', text: '잠시 후 다시 시도해주세요.', confirmButtonColor: '#2563eb' });
      } finally {
        this.isLoading = false;
      }
    }
  };
};
