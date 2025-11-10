pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract LangLearn_FHE is ZamaEthereumConfig {
    
    struct PronunciationData {
        string exerciseId;              
        euint32 encryptedAudioFeatures; 
        uint256 difficultyLevel;        
        uint256 targetScore;            
        string language;                
        address learner;                
        uint256 timestamp;              
        uint32 decryptedScore;          
        bool isEvaluated;               
    }
    
    mapping(string => PronunciationData) public pronunciationData;
    string[] public exerciseIds;
    
    event PronunciationDataCreated(string indexed exerciseId, address indexed learner);
    event EvaluationCompleted(string indexed exerciseId, uint32 decryptedScore);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createPronunciationData(
        string calldata exerciseId,
        string calldata language,
        externalEuint32 encryptedAudioFeatures,
        bytes calldata inputProof,
        uint256 difficultyLevel,
        uint256 targetScore
    ) external {
        require(bytes(pronunciationData[exerciseId].exerciseId).length == 0, "Exercise data already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedAudioFeatures, inputProof)), "Invalid encrypted audio features");
        
        pronunciationData[exerciseId] = PronunciationData({
            exerciseId: exerciseId,
            encryptedAudioFeatures: FHE.fromExternal(encryptedAudioFeatures, inputProof),
            difficultyLevel: difficultyLevel,
            targetScore: targetScore,
            language: language,
            learner: msg.sender,
            timestamp: block.timestamp,
            decryptedScore: 0,
            isEvaluated: false
        });
        
        FHE.allowThis(pronunciationData[exerciseId].encryptedAudioFeatures);
        FHE.makePubliclyDecryptable(pronunciationData[exerciseId].encryptedAudioFeatures);
        
        exerciseIds.push(exerciseId);
        
        emit PronunciationDataCreated(exerciseId, msg.sender);
    }
    
    function evaluatePronunciation(
        string calldata exerciseId, 
        bytes memory abiEncodedScore,
        bytes memory evaluationProof
    ) external {
        require(bytes(pronunciationData[exerciseId].exerciseId).length > 0, "Exercise data does not exist");
        require(!pronunciationData[exerciseId].isEvaluated, "Data already evaluated");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(pronunciationData[exerciseId].encryptedAudioFeatures);
        
        FHE.checkSignatures(cts, abiEncodedScore, evaluationProof);
        
        uint32 decodedScore = abi.decode(abiEncodedScore, (uint32));
        
        pronunciationData[exerciseId].decryptedScore = decodedScore;
        pronunciationData[exerciseId].isEvaluated = true;
        
        emit EvaluationCompleted(exerciseId, decodedScore);
    }
    
    function getEncryptedAudioFeatures(string calldata exerciseId) external view returns (euint32) {
        require(bytes(pronunciationData[exerciseId].exerciseId).length > 0, "Exercise data does not exist");
        return pronunciationData[exerciseId].encryptedAudioFeatures;
    }
    
    function getPronunciationData(string calldata exerciseId) external view returns (
        string memory language,
        uint256 difficultyLevel,
        uint256 targetScore,
        address learner,
        uint256 timestamp,
        bool isEvaluated,
        uint32 decryptedScore
    ) {
        require(bytes(pronunciationData[exerciseId].exerciseId).length > 0, "Exercise data does not exist");
        PronunciationData storage data = pronunciationData[exerciseId];
        
        return (
            data.language,
            data.difficultyLevel,
            data.targetScore,
            data.learner,
            data.timestamp,
            data.isEvaluated,
            data.decryptedScore
        );
    }
    
    function getAllExerciseIds() external view returns (string[] memory) {
        return exerciseIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


