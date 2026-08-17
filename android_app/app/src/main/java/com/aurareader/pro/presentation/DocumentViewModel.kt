package com.aurareader.pro.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aurareader.pro.domain.model.UnifiedDocument
import com.aurareader.pro.domain.repository.FileRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Presentation Layer ViewModel.
 * Demonstrates the Factory/Injection pattern via Hilt.
 * Depends strictly on interfaces (FileRepository) per Dependency Inversion Principle.
 */
@HiltViewModel
class DocumentViewModel @Inject constructor(
    private val fileRepository: FileRepository
) : ViewModel() {

    private val _documents = MutableStateFlow<List<UnifiedDocument>>(emptyList())
    val documents: StateFlow<List<UnifiedDocument>> = _documents.asStateFlow()

    init {
        loadDocuments()
    }

    private fun loadDocuments() {
        viewModelScope.launch {
            // Observe the offline-first data source reactively
            fileRepository.getAllDocuments().collect { docs ->
                _documents.value = docs
            }
        }
    }

    fun importDocument(document: UnifiedDocument) {
        viewModelScope.launch {
            fileRepository.addDocument(document)
        }
    }
}
