// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.26;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/interfaces/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "./CsigmaERC7575Vault.sol";

/// @title ICsigmaPool
/// @notice Interface for CsigmaV3Pool contract
interface ICsigmaPool{
    function fundManager() external view returns (address);
    function poolManager() external view returns (address);
    function share() external view returns (address);
}

/// @title IShareTokens
/// @notice Interface for CsigmaUSD contract
interface IShareTokens {
    function isBlacklisted(address account) external returns (bool);
}

/// @title CsigmaV3WithdrawalManager
/// @notice Manages fund withdrawals using a queue-based system for the cSigma protocol
/// @dev This contract handles withdrawal requests, repayments, and claims in a FIFO queue system
/// @dev Supports partial fulfillment of withdrawal requests based on available reserves
/// @author cSigma Finance Inc.
contract CsigmaV3WithdrawalManager is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable
{
    /// @notice Role identifier for managers who can execute repayments
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    /// @notice Represents a withdrawal request in the queue
    /// @param pendingShareTokenAmount Amount of share tokens still pending withdrawal
    /// @param cumulativeShareTokenAmount Total cumulative share tokens up to this position
    /// @param fulfilledAmount Amount of underlying tokens already fulfilled for this request
    /// @param owner Address that owns this withdrawal request
    /// @param isRepaymentCheckPoint Whether this position serves as a repayment checkpoint
    struct WithdrawalRequest {
        uint256 pendingShareTokenAmount;
        uint256 cumulativeShareTokenAmount;
        uint256 fulfilledAmount;
        address owner;
        bool isRepaymentCheckPoint;
    }

    /// @notice Represents repayment data for calculating exchange ratios
    /// @param queuePosition Queue position where this repayment was made
    /// @param exchangeRatio Exchange ratio between share tokens and underlying tokens at repayment time
    struct RepaymentData {
        uint256 queuePosition;
        uint256 exchangeRatio;
    }

    /// @notice The underlying token used for withdrawals (e.g., USDC, USDT) 
    IERC20Upgradeable  public underlyingToken;
    
    /// @notice The cSigma V3 Pool contract instance
    CsigmaV3Pool public csigmaV3Pool;

    /// @notice Current position in the withdrawal queue (last assigned position)
    uint256 public currentQueuePosition;
    
    /// @notice Last fulfilled position in the withdrawal queue
    uint256 public fulfilledQueuePosition;
    
    /// @notice Total amount of share tokens currently due for withdrawal
    uint256 public totalDueShareToken;

    /// @notice Array storing repayment data for exchange ratio calculations
    RepaymentData[] public repaymentData;
    
    /// @notice Mapping from queue position to withdrawal request details
    mapping (uint256 => WithdrawalRequest) public withdrawalQueue;
    
    /// @notice Mapping from user address to their queue positions
    mapping (address => uint256[]) public withdrawalQueuePositions;

    /// @notice Address of the share token contract (csUSD)
    address public shareToken;
    
    /// @notice Address of the cSigma router contract
    address public csigmaRouter;

    /// @notice Emitted when a new withdrawal request is created
    /// @param queuePosition Position assigned to the request in the queue
    /// @param owner Address of the request owner
    /// @param shares Amount of share tokens requested for withdrawal
    event WithdrawRequest(uint256 indexed queuePosition, address indexed owner, uint256 shares);
    
    /// @notice Emitted when a withdrawal request is claimed
    /// @param queuePosition Position of the request in the queue
    /// @param owner Address of the request owner
    /// @param amount Amount of underlying tokens claimed
    event Claim(uint256 indexed queuePosition, address indexed owner, uint256 amount);
    
    /// @notice Emitted when a repayment is processed
    /// @param queuePosition Position up to which the repayment was processed
    /// @param repaymentShares Amount of share tokens used for repayment
    /// @param exchangeRatio Exchange ratio used for the repayment
    /// @param queuePositionFulfilledAmount Amount fulfilled at the specific queue position
    event Repayment(uint256 indexed queuePosition, uint256 repaymentShares, uint256 exchangeRatio, uint256 queuePositionFulfilledAmount);

    /// @notice Emitted when a funds withdrawal from contract is processes
    /// @param _token The address of the token
    /// @param _to The address to which the funds are withdrawn
    /// @param _amount The amount to withdraw
    event EmergencyWithdraw(address _token, address _to, uint256 _amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the withdrawal manager contract
    /// @dev Sets up access control, assigns manager roles, and initializes state variables
    /// @param _underlyingToken Address of the underlying token (e.g., USDC)
    /// @param _csigmaV3Pool Address of the cSigma V3 Pool contract
    /// @param _csigmaRouter Address of the cSigma router contract
    function initialize(address _underlyingToken, address _csigmaV3Pool, address _csigmaRouter) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, ICsigmaPool(_csigmaV3Pool).fundManager());
        _grantRole(MANAGER_ROLE, ICsigmaPool(_csigmaV3Pool).poolManager());
        underlyingToken = IERC20Upgradeable(_underlyingToken);
        csigmaV3Pool = CsigmaV3Pool(_csigmaV3Pool);
        shareToken = ICsigmaPool(_csigmaV3Pool).share();
        csigmaRouter = _csigmaRouter;
        repaymentData.push(RepaymentData(0, 0));
    }

    /// @notice Creates a withdrawal request for the user by entering the queue
    /// @dev If there are enough reserves, the user will receive (partially or completely) the underlying tokens immediately
    /// @param _shareTokenAmount The amount of share tokens to withdraw
    /// @param _owner The address of the user who owns the request
    /// @param _receiver The address of the receiver of the underlying tokens
    /// @return amountReceived The amount of underlying tokens received
    function requestWithdrawal(
        uint256 _shareTokenAmount, 
        address _owner, 
        address _receiver
    ) 
        external 
        returns (uint256 amountReceived) 
    {
        if (_shareTokenAmount == 0) {
            revert ("shareToken amount is zero");
        }
        csigmaV3Pool.transferFrom(msg.sender, address(this), _shareTokenAmount);
        uint256 reserve = csigmaV3Pool.maxRedeem(address(0));
        if (totalDueShareToken + _shareTokenAmount < reserve) {
            amountReceived = csigmaV3Pool.redeem(_shareTokenAmount, _receiver, address(this));
            emit Claim(0, _owner, amountReceived);
            return amountReceived;
        } else if(totalDueShareToken < reserve) {
            uint256 redeemAmount = (reserve - totalDueShareToken);
            amountReceived = csigmaV3Pool.redeem(redeemAmount, _receiver, address(this));
            emit Claim(0, _owner, amountReceived);
            _shareTokenAmount -= redeemAmount;
        } 
        totalDueShareToken += _shareTokenAmount;
        if (currentQueuePosition == 0) {
            withdrawalQueue[++currentQueuePosition] = WithdrawalRequest(_shareTokenAmount, _shareTokenAmount, 0, _owner, false);
            withdrawalQueuePositions[_owner].push(1);
            emit WithdrawRequest(1, _owner, _shareTokenAmount);
        }
        else {
            ++currentQueuePosition;
            withdrawalQueue[currentQueuePosition] = WithdrawalRequest(_shareTokenAmount, withdrawalQueue[currentQueuePosition - 1].cumulativeShareTokenAmount + _shareTokenAmount, 0, _owner, false);
            withdrawalQueuePositions[_owner].push(currentQueuePosition);
            emit WithdrawRequest(currentQueuePosition, _owner, _shareTokenAmount);
        }
        return amountReceived;
    }

    /// @notice Claims the underlying tokens for the user
    /// @dev The user can claim the underlying tokens only if the request is fulfilled
    /// @param queuePosition The position in the queue of the request
    /// @param repaymentDataIndex The index of the repayment data
    /// @return owner The address of the user who owns the request
    /// @return claimedAmount The amount of underlying tokens claimed
    function claim(uint256 queuePosition, uint256 repaymentDataIndex) external returns (address owner, uint256 claimedAmount) {
        WithdrawalRequest memory request = withdrawalQueue[queuePosition];
        require(!IShareTokens(shareToken).isBlacklisted(request.owner), "Assets are frozen");
        address receiver = csigmaRouter;
        if (msg.sender != csigmaRouter) {
            receiver = msg.sender;
            if (msg.sender != request.owner) 
                revert ("Request is not owned by the caller");
        }
        if (queuePosition > fulfilledQueuePosition) {
            revert ("Queue position is not fulfilled yet");
        }
        if (request.isRepaymentCheckPoint) {
            if(request.fulfilledAmount == 0) {
                revert ("Request has been claimed");
            }
            SafeERC20Upgradeable.safeTransfer(underlyingToken, receiver, request.fulfilledAmount);
            emit Claim(queuePosition, request.owner, request.fulfilledAmount);
            withdrawalQueue[queuePosition].fulfilledAmount = 0;
            owner = request.owner;
            claimedAmount = request.fulfilledAmount;
        } else {
            RepaymentData memory lowerData = repaymentData[repaymentDataIndex - 1];
            RepaymentData memory currentData = repaymentData[repaymentDataIndex];
            if (lowerData.queuePosition >= queuePosition || currentData.queuePosition < queuePosition) {
                revert ("Repayment data index is not valid");
            }
            uint256 exchangeRatio = currentData.exchangeRatio;
            claimedAmount = request.pendingShareTokenAmount * exchangeRatio / 10 ** IERC20Metadata(shareToken).decimals();
            withdrawalQueue[queuePosition].pendingShareTokenAmount = 0;
            if(claimedAmount == 0) {
                revert ("Request has been claimed");
            }
            emit Claim(queuePosition, receiver, claimedAmount);
            SafeERC20Upgradeable.safeTransfer(underlyingToken, receiver, claimedAmount);
            owner = request.owner;
        }
    }

    /// @notice Repays the fund using Share tokens
    /// @dev The repayment is done using a queue system, where the user can specify the position in the queue to repay up to
    /// @param uptoQueuePosition The position in the queue to repay up to
    /// @param amount The amount of Share tokens to repay
    function repay(uint256 uptoQueuePosition, uint256 amount) external onlyRole(MANAGER_ROLE) {
        if (fulfilledQueuePosition > uptoQueuePosition) {
            revert ("Queue position is not valid");
        }

        if (totalDueShareToken == 0) {
            return;
        }
        
        if (uptoQueuePosition > currentQueuePosition) {
            uptoQueuePosition = currentQueuePosition;
        }

        uint256 paymentShareTokenAmount = csigmaV3Pool.previewWithdraw(amount);
        if (paymentShareTokenAmount > totalDueShareToken) {
            paymentShareTokenAmount = totalDueShareToken;
        }
        uint256 amountReceived = csigmaV3Pool.previewRedeem(paymentShareTokenAmount);
        uint256 maxWithdraw = csigmaV3Pool.maxWithdraw(address(0));
        if (maxWithdraw <= amountReceived) {
            paymentShareTokenAmount = csigmaV3Pool.withdraw(maxWithdraw, address(this), address(this));
            amountReceived = maxWithdraw;
        } else {
            csigmaV3Pool.redeem(paymentShareTokenAmount, address(this), address(this));
        }
        uint256 multiplier = 10 ** IERC20Metadata(shareToken).decimals();
        uint256 exchangeRatio = (amountReceived * multiplier) / paymentShareTokenAmount;

        uint256 fulfilledShareToken;

        if (fulfilledQueuePosition < uptoQueuePosition) {

            uint256 dueShareToken = withdrawalQueue[uptoQueuePosition].cumulativeShareTokenAmount 
                                + withdrawalQueue[fulfilledQueuePosition].pendingShareTokenAmount
                                - withdrawalQueue[fulfilledQueuePosition].cumulativeShareTokenAmount;
  
            if (
                paymentShareTokenAmount 
                    <= withdrawalQueue[uptoQueuePosition - 1].cumulativeShareTokenAmount 
                        + withdrawalQueue[fulfilledQueuePosition].pendingShareTokenAmount
                        - withdrawalQueue[fulfilledQueuePosition].cumulativeShareTokenAmount 
            ) {
                revert ("Payment amount is not enough");
            }

            uint256 pendingShareTokenAmount = dueShareToken - paymentShareTokenAmount;
            fulfilledShareToken = withdrawalQueue[uptoQueuePosition].pendingShareTokenAmount - pendingShareTokenAmount;

            withdrawalQueue[uptoQueuePosition].pendingShareTokenAmount = pendingShareTokenAmount;
            withdrawalQueue[uptoQueuePosition].isRepaymentCheckPoint = true;
            withdrawalQueue[uptoQueuePosition].fulfilledAmount += (fulfilledShareToken * exchangeRatio) / multiplier;

            withdrawalQueue[fulfilledQueuePosition].fulfilledAmount += (withdrawalQueue[fulfilledQueuePosition].pendingShareTokenAmount * exchangeRatio) / multiplier;
            withdrawalQueue[fulfilledQueuePosition].pendingShareTokenAmount = 0;

            fulfilledQueuePosition = uptoQueuePosition;
            emit Repayment(uptoQueuePosition, paymentShareTokenAmount, exchangeRatio, (fulfilledShareToken * exchangeRatio) / multiplier);
            repaymentData.push(RepaymentData(uptoQueuePosition - 1, exchangeRatio));

        } else {
            uint256 dueShareToken = withdrawalQueue[uptoQueuePosition].pendingShareTokenAmount;
            uint256 pendingShareTokenAmount = dueShareToken - paymentShareTokenAmount;
            withdrawalQueue[uptoQueuePosition].pendingShareTokenAmount = pendingShareTokenAmount;
            withdrawalQueue[uptoQueuePosition].fulfilledAmount += (paymentShareTokenAmount * exchangeRatio) / multiplier;
            emit Repayment(uptoQueuePosition, paymentShareTokenAmount, exchangeRatio, (paymentShareTokenAmount * exchangeRatio) / multiplier);
        }
        totalDueShareToken -= paymentShareTokenAmount;
    }

    /// @notice Updates the csigmaRouter address
    /// @param _csigmaRouter The address of the new csigmaRouter
    function updateCsigmaRouter(address _csigmaRouter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        csigmaRouter = _csigmaRouter;
    }

    /// @notice Withdraws the funds from the contract
    /// @dev Only the admin can call this function
    /// @param _token The address of the token
    /// @param _to The address to which the funds are withdrawn
    /// @param _amount The amount to withdraw
    function emergencyWithdraw(address _token, address _to, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(_token), _to, _amount);
        emit EmergencyWithdraw(_token, _to, _amount);
    }

    /// @notice Upgrades the contract to a new implementation
    /// @dev Only the admin can call this function
    /// @param _newImplementation The address of the new implementation
    function _authorizeUpgrade(address _newImplementation)
        internal
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {}

    /// @notice Returns the checkpoint of the repayment data
    function getRepaymentData() external view returns (RepaymentData[] memory) {
        return repaymentData;
    }

    /// @notice Returns the length of the repayment data
    function getRepaymentDataLength() external view returns (uint256) {
        return repaymentData.length;
    }

    /// @notice Returns total number of requests in the queue for given user
    /// @param user The address of the user
    /// @return The number of requests in the queue for the user
    function getUserRequestsCount(address user) external view returns (uint256) {
        return withdrawalQueuePositions[user].length;
    }

    /// @notice Extended withdrawal request data for external queries
    /// @param queuePosition Position of the request in the withdrawal queue
    /// @param pendingShareTokenAmount Amount of share tokens still pending
    /// @param cumulativeShareTokenAmount Cumulative share token amount up to this position
    /// @param fulfilledAmount Amount already fulfilled in underlying tokens
    /// @param owner Owner of the withdrawal request
    /// @param isRepaymentCheckPoint Whether this is a repayment checkpoint
    struct WithdrawalRequestData {
        uint256 queuePosition;
        uint256 pendingShareTokenAmount;
        uint256 cumulativeShareTokenAmount;
        uint256 fulfilledAmount;
        address owner;
        bool isRepaymentCheckPoint;
    }

    /// @notice Returns the requests in the queue for given user
    /// @param user The address of the user
    /// @return requests The array of requests in the queue for the user
    function getUserRequests(address user) external view returns (WithdrawalRequestData[] memory requests) {
        uint256[] memory positions = withdrawalQueuePositions[user];
        requests = new WithdrawalRequestData[](positions.length);
        for (uint256 i = 0; i < positions.length; i++) {
            requests[i] = WithdrawalRequestData(
                positions[i],
                withdrawalQueue[positions[i]].pendingShareTokenAmount,
                withdrawalQueue[positions[i]].cumulativeShareTokenAmount,
                withdrawalQueue[positions[i]].fulfilledAmount,
                withdrawalQueue[positions[i]].owner,
                withdrawalQueue[positions[i]].isRepaymentCheckPoint
            );
        }
    }

    /// @notice Returns the LP token address (alias for shareToken)
    /// @dev Provided for compatibility with external interfaces
    /// @return The address of the share/LP token
    function LPToken() external view returns (address) {
        return shareToken;
    }

    /// @notice Returns the total amount of share tokens currently due for withdrawal
    /// @dev Provided for compatibility with external interfaces
    /// @return The amount of total due share token
    function totalDueLPToken() external view returns (uint256) {
        return totalDueShareToken;
    }
}