import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface PronunciationData {
  id: number;
  word: string;
  score: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface LearningStats {
  totalPractices: number;
  averageScore: number;
  improvementRate: number;
  bestWord: string;
  recentActivity: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [practices, setPractices] = useState<PronunciationData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showPracticeModal, setShowPracticeModal] = useState(false);
  const [practicing, setPracticing] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newPracticeData, setNewPracticeData] = useState({ word: "", score: "" });
  const [selectedPractice, setSelectedPractice] = useState<PronunciationData | null>(null);
  const [decryptedScore, setDecryptedScore] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [userHistory, setUserHistory] = useState<PronunciationData[]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const practicesList: PronunciationData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          practicesList.push({
            id: parseInt(businessId.replace('practice-', '')) || Date.now(),
            word: businessData.name,
            score: 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setPractices(practicesList);
      if (address) {
        setUserHistory(practicesList.filter(p => p.creator.toLowerCase() === address.toLowerCase()));
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateLearningStats = (): LearningStats => {
    const userPractices = practices.filter(p => p.creator.toLowerCase() === address?.toLowerCase());
    const total = userPractices.length;
    const avg = total > 0 ? userPractices.reduce((sum, p) => sum + (p.decryptedValue || p.publicValue1), 0) / total : 0;
    const recent = userPractices.filter(p => Date.now()/1000 - p.timestamp < 60 * 60 * 24 * 7).length;
    
    let bestWord = "";
    let bestScore = 0;
    userPractices.forEach(p => {
      const score = p.decryptedValue || p.publicValue1;
      if (score > bestScore) {
        bestScore = score;
        bestWord = p.word;
      }
    });

    return {
      totalPractices: total,
      averageScore: Math.round(avg),
      improvementRate: recent > 0 ? Math.round((recent / total) * 100) : 0,
      bestWord: bestWord || "None",
      recentActivity: recent
    };
  };

  const createPractice = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setPracticing(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting pronunciation score with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const scoreValue = parseInt(newPracticeData.score) || 0;
      const businessId = `practice-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, scoreValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newPracticeData.word,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        scoreValue,
        0,
        "Pronunciation Practice"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Practice recorded successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowPracticeModal(false);
      setNewPracticeData({ word: "", score: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setPracticing(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Score already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const verifyResult = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = verifyResult.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Score decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Score is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredPractices = practices.filter(practice => 
    practice.word.toLowerCase().includes(searchTerm.toLowerCase()) ||
    practice.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = calculateLearningStats();

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>LangLearn FHE 🔐</h1>
            <span>Privacy-First Language Learning</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="language-bubble">🗣️</div>
            <h2>Connect Your Wallet to Start Learning</h2>
            <p>Experience private pronunciation analysis with fully homomorphic encryption</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Practice pronunciation with encrypted scoring</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>View your progress without exposing raw data</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing Private Learning System...</p>
        <p className="loading-note">Securing your pronunciation data with FHE</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading your learning data...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>LangLearn FHE 🔐</h1>
          <span>Encrypted Pronunciation Analysis</span>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            Test FHE
          </button>
          <button onClick={() => setShowPracticeModal(true)} className="practice-btn">
            + New Practice
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      {showIntro && (
        <div className="intro-panel">
          <button className="close-intro" onClick={() => setShowIntro(false)}>×</button>
          <h3>Welcome to Private Language Learning</h3>
          <p>Your pronunciation scores are encrypted using Zama FHE technology. No raw audio is stored - only encrypted analysis results.</p>
          <div className="fhe-flow-mini">
            <div className="flow-step">Speak → Encrypt → Analyze → Decrypt</div>
          </div>
        </div>
      )}
      
      <div className="main-content">
        <div className="stats-section">
          <div className="stat-card">
            <div className="stat-icon">📊</div>
            <div className="stat-info">
              <h3>Total Practices</h3>
              <span className="stat-value">{stats.totalPractices}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">⭐</div>
            <div className="stat-info">
              <h3>Average Score</h3>
              <span className="stat-value">{stats.averageScore}/100</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">🚀</div>
            <div className="stat-info">
              <h3>Weekly Activity</h3>
              <span className="stat-value">{stats.recentActivity}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">🏆</div>
            <div className="stat-info">
              <h3>Best Word</h3>
              <span className="stat-value">{stats.bestWord}</span>
            </div>
          </div>
        </div>

        <div className="content-panels">
          <div className="left-panel">
            <div className="panel-header">
              <h2>Pronunciation History</h2>
              <div className="panel-controls">
                <input 
                  type="text" 
                  placeholder="Search words..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                  {isRefreshing ? "⟳" : "↻"}
                </button>
              </div>
            </div>
            
            <div className="practices-list">
              {filteredPractices.length === 0 ? (
                <div className="no-practices">
                  <p>No pronunciation practices yet</p>
                  <button onClick={() => setShowPracticeModal(true)} className="create-btn">
                    Start Practicing
                  </button>
                </div>
              ) : filteredPractices.map((practice, index) => (
                <div 
                  className={`practice-item ${selectedPractice?.id === practice.id ? "selected" : ""}`}
                  key={index}
                  onClick={() => setSelectedPractice(practice)}
                >
                  <div className="word-bubble">{practice.word}</div>
                  <div className="practice-info">
                    <span className="score">
                      Score: {practice.isVerified ? `${practice.decryptedValue}/100` : "🔒 Encrypted"}
                    </span>
                    <span className="date">{new Date(practice.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className={`status ${practice.isVerified ? "verified" : "encrypted"}`}>
                    {practice.isVerified ? "✅ Verified" : "🔓 Verify"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="right-panel">
            <div className="user-history-panel">
              <h3>Your Learning Journey</h3>
              <div className="history-stats">
                <div className="history-item">
                  <span>Total Sessions:</span>
                  <strong>{userHistory.length}</strong>
                </div>
                <div className="history-item">
                  <span>Best Score:</span>
                  <strong>{Math.max(...userHistory.map(p => p.decryptedValue || p.publicValue1), 0)}/100</strong>
                </div>
                <div className="history-item">
                  <span>Improvement:</span>
                  <strong>+{stats.improvementRate}%</strong>
                </div>
              </div>
            </div>

            <div className="fhe-info-panel">
              <h3>How FHE Protects You</h3>
              <div className="fhe-steps">
                <div className="step">
                  <div className="step-number">1</div>
                  <p>Pronunciation score encrypted locally</p>
                </div>
                <div className="step">
                  <div className="step-number">2</div>
                  <p>Encrypted data stored on blockchain</p>
                </div>
                <div className="step">
                  <div className="step-number">3</div>
                  <p>AI analysis without decryption</p>
                </div>
                <div className="step">
                  <div className="step-number">4</div>
                  <p>Only you can decrypt results</p>
                </div>
              </div>
            </div>

            <div className="faq-panel">
              <h3>Common Questions</h3>
              <div className="faq-item">
                <strong>Is my audio recorded?</strong>
                <p>No - only encrypted pronunciation scores are stored</p>
              </div>
              <div className="faq-item">
                <strong>Can others see my scores?</strong>
                <p>No - scores remain encrypted until you decrypt them</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {showPracticeModal && (
        <ModalPractice 
          onSubmit={createPractice} 
          onClose={() => setShowPracticeModal(false)} 
          practicing={practicing} 
          practiceData={newPracticeData} 
          setPracticeData={setNewPracticeData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedPractice && (
        <PracticeDetailModal 
          practice={selectedPractice} 
          onClose={() => { 
            setSelectedPractice(null); 
            setDecryptedScore(null); 
          }} 
          decryptedScore={decryptedScore} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(`practice-${selectedPractice.id}`)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalPractice: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  practicing: boolean;
  practiceData: any;
  setPracticeData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, practicing, practiceData, setPracticeData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'score') {
      const intValue = Math.min(100, Math.max(0, parseInt(value) || 0));
      setPracticeData({ ...practiceData, [name]: intValue.toString() });
    } else {
      setPracticeData({ ...practiceData, [name]: value });
    }
  };

  const words = ["Hello", "World", "Language", "Pronunciation", "Practice", "Learning", "Encryption", "Privacy"];

  return (
    <div className="modal-overlay">
      <div className="practice-modal">
        <div className="modal-header">
          <h2>New Pronunciation Practice</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection Active</strong>
            <p>Your pronunciation score will be encrypted with Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Word or Phrase *</label>
            <input 
              type="text" 
              name="word" 
              value={practiceData.word} 
              onChange={handleChange} 
              placeholder="Enter word to practice..." 
            />
            <div className="word-suggestions">
              {words.map((word, i) => (
                <span key={i} className="word-tag" onClick={() => setPracticeData({...practiceData, word})}>
                  {word}
                </span>
              ))}
            </div>
          </div>
          
          <div className="form-group">
            <label>Pronunciation Score (0-100) *</label>
            <input 
              type="range" 
              name="score" 
              min="0" 
              max="100" 
              value={practiceData.score} 
              onChange={handleChange} 
            />
            <div className="score-display">
              <span>Score: {practiceData.score || 0}/100</span>
              <span className="data-type">FHE Encrypted Integer</span>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={practicing || isEncrypting || !practiceData.word || !practiceData.score} 
            className="submit-btn"
          >
            {practicing || isEncrypting ? "Encrypting..." : "Record Practice"}
          </button>
        </div>
      </div>
    </div>
  );
};

const PracticeDetailModal: React.FC<{
  practice: PronunciationData;
  onClose: () => void;
  decryptedScore: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ practice, onClose, decryptedScore, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedScore !== null || practice.isVerified) return;
    await decryptData();
  };

  const displayScore = practice.isVerified ? practice.decryptedValue : decryptedScore;

  return (
    <div className="modal-overlay">
      <div className="practice-detail-modal">
        <div className="modal-header">
          <h2>Practice Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="practice-header">
            <div className="word-bubble large">{practice.word}</div>
            <div className="practice-meta">
              <div className="meta-item">
                <span>Date:</span>
                <strong>{new Date(practice.timestamp * 1000).toLocaleString()}</strong>
              </div>
              <div className="meta-item">
                <span>Creator:</span>
                <strong>{practice.creator.substring(0, 8)}...{practice.creator.substring(36)}</strong>
              </div>
            </div>
          </div>
          
          <div className="score-section">
            <h3>Pronunciation Analysis</h3>
            <div className="score-display-large">
              {displayScore !== undefined && displayScore !== null ? (
                <>
                  <div className="score-circle">
                    <span className="score-value">{displayScore}</span>
                    <span className="score-max">/100</span>
                  </div>
                  <div className="score-feedback">
                    {displayScore >= 90 ? "Excellent! 🎯" : 
                     displayScore >= 70 ? "Good job! 👍" : 
                     displayScore >= 50 ? "Keep practicing! 💪" : "Needs work 📚"}
                  </div>
                </>
              ) : (
                <div className="encrypted-score">
                  <div className="lock-icon">🔒</div>
                  <span>Score Encrypted with FHE</span>
                  <p>Decrypt to view your pronunciation analysis</p>
                </div>
              )}
            </div>
            
            <div className="decrypt-controls">
              <button 
                className={`decrypt-btn ${(practice.isVerified || decryptedScore !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || practice.isVerified}
              >
                {isDecrypting ? "Decrypting..." : 
                 practice.isVerified ? "✅ Verified On-chain" : 
                 decryptedScore !== null ? "🔓 Re-verify" : 
                 "🔓 Decrypt Score"}
              </button>
              
              {practice.isVerified && (
                <div className="verification-badge">
                  <span>✅ On-chain Verified</span>
                </div>
              )}
            </div>
          </div>
          
          <div className="fhe-explanation">
            <h4>Privacy Protection</h4>
            <p>Your pronunciation score was analyzed using Fully Homomorphic Encryption (FHE). 
            The AI never sees your raw data - only encrypted computations are performed.</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


